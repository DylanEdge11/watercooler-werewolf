import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  /** When set, loadActions returns this instead of the database rows, to simulate a stale read. */
  staleActions: null as unknown[] | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/chat/rooms', () => ({ ensureGameRooms: async () => {} }));
vi.mock('./game/phase-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./game/phase-store')>();
  return {
    ...actual,
    loadActions: async (phaseId: string) => shared.staleActions ?? actual.loadActions(phaseId),
  };
});

import { POST as phasePost } from '../app/api/games/[gameId]/phases/route';

let client: Client;
const context = { params: Promise.resolve({ gameId: 'game' }) };

function post(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/games/game/phases', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function act(body: Record<string, unknown>) {
  const response = await phasePost(post({ phaseId: 'phase', ...body }), context);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function phaseStatus(): Promise<string> {
  return String((await client.execute("SELECT status FROM phases WHERE id = 'phase'")).rows[0]?.status);
}

async function saveShot(id: string, targetId: string, version = 1): Promise<void> {
  await client.execute({
    sql: "INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES (?, 'phase', 'p0', 'HUNTER_SHOT', ?, ?, ?)",
    args: [id, JSON.stringify([targetId]), version, new Date().toISOString()],
  });
}

async function expireHunterWindow(): Promise<void> {
  await client.execute({ sql: "UPDATE phases SET hunter_deadline_at = ? WHERE id = 'phase'", args: [new Date(Date.now() - 60_000).toISOString()] });
}

/** Eight fictional players; P0 is the Hunter and three villagers vote them out on an open Day. */
beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.staleActions = null;
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Hunter test','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
    { sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')", args: [] },
    { sql: "INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('phase','game',1,'DAY','OPEN','2026-01-01','2099-01-01',1,30,'2026-01-01','2026-01-01')", args: [] },
  ], 'write');
  const roles = ['HUNTER', 'VILLAGER', 'VILLAGER', 'VILLAGER', 'VILLAGER', 'VILLAGER', 'WEREWOLF', 'WEREWOLF'];
  for (const [index, role] of roles.entries()) {
    await client.batch([
      { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?, 'game', ?, ?, 'CLAIMED', ?, '2026-01-01', '2026-01-01')", args: [`p${index}`, `Player ${index}`, `p${index}@pilot.test`, `hash-${index}`] },
      { sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game', ?, ?, 'batch')", args: [`p${index}`, role] },
    ], 'write');
  }
  for (const actor of ['p1', 'p2', 'p3']) {
    await client.execute({ sql: "INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES (?, 'phase', ?, 'DAY_VOTE', '[\"p0\"]', 1, '2026-01-01')", args: [`vote-${actor}`, actor] });
  }
  expect((await act({ action: 'LOCK_AND_PROPOSE' })).status).toBe(200);
  expect(await phaseStatus()).toBe('PENDING_HUNTER');
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('Hunter follow-up', () => {
  test('an override that includes the shot target sends the Hunter back to choose, and the phase can still publish', async () => {
    await saveShot('shot', 'p1');
    expect((await act({ action: 'FINALIZE_HUNTER' })).status).toBe(200);
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');

    const override = await act({ action: 'PUBLISH', overrideReason: 'Correcting the recorded result', overrideEliminationIds: ['p0', 'p1'] });
    expect(override.body).toMatchObject({ pendingHunter: true });
    // The old shot at P1 no longer counts; the Hunter chooses again against the corrected result.
    expect((await client.execute("SELECT superseded_at FROM action_submissions WHERE id = 'shot'")).rows[0]?.superseded_at).not.toBeNull();

    await expireHunterWindow();
    expect((await act({ action: 'FINALIZE_HUNTER', skipHunter: true })).status).toBe(200);
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
    expect((await act({ action: 'PUBLISH' })).body).toMatchObject({ ok: true, winner: null });
    expect(await phaseStatus()).toBe('PUBLISHED');
  });

  test('a saved shot that has become invalid counts as no shot instead of looping back to the Hunter', async () => {
    // A shot at a player already in the result (only reachable through older data).
    await client.execute("UPDATE resolution_proposals SET reviewed_outcome_json = json_set(outcome_json, '$.eliminations', json('[{\"playerId\":\"p0\",\"cause\":\"DAY_VOTE\"},{\"playerId\":\"p1\",\"cause\":\"DAY_VOTE\"}]'))");
    await saveShot('stale-shot', 'p1');
    const finalized = await act({ action: 'FINALIZE_HUNTER' });
    expect(finalized.status).toBe(200);
    expect((finalized.body.outcome as { hunterRequiredIds: string[] }).hunterRequiredIds).toEqual([]);
    expect((await act({ action: 'PUBLISH' })).status).toBe(200);
    expect(await phaseStatus()).toBe('PUBLISHED');
  });

  test('an error while finalizing leaves the phase waiting for the Hunter, not stranded', async () => {
    await saveShot('shot', 'p1');
    await client.execute("UPDATE resolution_proposals SET override_json = 'not json'");
    expect((await act({ action: 'FINALIZE_HUNTER' })).status).toBe(400);
    expect(await phaseStatus()).toBe('PENDING_HUNTER');
  });

  test('a shot saved after the finalize read makes the finalize change nothing', async () => {
    await saveShot('late-shot', 'p1');
    await expireHunterWindow();
    // The finalize read saw no shot, but one is now saved.
    shared.staleActions = [];
    expect((await act({ action: 'FINALIZE_HUNTER', skipHunter: true })).status).toBe(409);
    shared.staleActions = null;
    expect(await phaseStatus()).toBe('PENDING_HUNTER');
    const finalized = await act({ action: 'FINALIZE_HUNTER' });
    expect((finalized.body.outcome as { eliminations: Array<{ playerId: string }> }).eliminations.map((item) => item.playerId)).toEqual(['p0', 'p1']);
  });

  test('a phase stranded mid-finalize by an older build can be finalized', async () => {
    await saveShot('shot', 'p1');
    await client.execute("UPDATE phases SET status = 'HUNTER_FINALIZING', version = version + 1 WHERE id = 'phase'");
    expect((await act({ action: 'FINALIZE_HUNTER' })).status).toBe(200);
    expect(await phaseStatus()).toBe('PENDING_APPROVAL');
  });

  test('an override list that is not a list of ids is refused with a clear message', async () => {
    await saveShot('shot', 'p1');
    await act({ action: 'FINALIZE_HUNTER' });
    const refused = await act({ action: 'PUBLISH', overrideReason: 'Correcting the recorded result', overrideEliminationIds: 'p1' });
    expect(refused).toMatchObject({ status: 400, body: { error: 'Override eliminations must be a list of player ids.' } });
  });
});
