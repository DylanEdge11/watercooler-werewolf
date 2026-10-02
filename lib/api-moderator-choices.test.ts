import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import type { PhaseChoices } from './game/moderator-choices';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  currentPlayer: null as { seatId: string; gameId: string; displayName: string; alive: boolean } | null,
  moderatorError: null as { status: number; message: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', async () => {
  const { HttpError } = await import('../lib/http/errors');
  return {
    requireGameModerator: async () => {
      if (shared.moderatorError) throw new HttpError(shared.moderatorError.status, shared.moderatorError.message);
      return { id: 'mod' };
    },
  };
});
vi.mock('../lib/auth/session', () => ({
  getCurrentPlayer: async () => shared.currentPlayer,
  getCurrentSpectator: async () => null,
}));
vi.mock('../lib/http/rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('./http/rate-limit')>(),
  enforceRateLimit: async () => {},
}));

import { POST as actionPost } from '../app/api/phases/[phaseId]/actions/route';
import { POST as phasePost } from '../app/api/games/[gameId]/phases/route';
import { GET as choicesGet } from '../app/api/games/[gameId]/choices/route';
import { ensureGameRooms } from './chat/rooms';

let client: Client;

const gameContext = { params: Promise.resolve({ gameId: 'game' }) };

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function act(seatId: string, phaseId: string, actionKind: string, targetIds: string[]) {
  shared.currentPlayer = { seatId, gameId: 'game', displayName: seatId, alive: true };
  const response = await actionPost(post(`/api/phases/${phaseId}/actions`, { actionKind, targetIds }), { params: Promise.resolve({ phaseId }) });
  expect(response.status).toBe(200);
}

async function phaseAction(phaseId: string, action: string) {
  const response = await phasePost(post('/api/games/game/phases', { phaseId, action }), gameContext);
  expect(response.status).toBe(200);
}

async function choices(): Promise<{ status: number; phases: PhaseChoices[] }> {
  const response = await choicesGet(new Request('http://localhost:3000/api/games/game/choices'), gameContext);
  const body = await response.json() as { phases?: PhaseChoices[] };
  return { status: response.status, phases: body.phases ?? [] };
}

const exec = (sql: string, args: Array<string | number | null> = []) => client.execute({ sql, args });

/** Six fictional players on an open first Day: p0 Seer, p1 Bodyguard, p2 Cupid, p3 and p4 Werewolves, p5 Villager. */
beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.currentPlayer = null;
  shared.moderatorError = null;
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Choices test','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
    { sql: "INSERT INTO assignment_batches (id,game_id,revision,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,'[]','hash','mod','2026-01-01')", args: [] },
    { sql: "INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('day1','game',1,'DAY','OPEN','2026-01-01','2099-01-01',1,30,'2026-01-01','2026-01-01')", args: [] },
  ], 'write');
  const roles = ['SEER', 'BODYGUARD', 'CUPID', 'WEREWOLF', 'WEREWOLF', 'VILLAGER'];
  for (const [index, role] of roles.entries()) {
    await client.batch([
      { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES (?, 'game', ?, ?, 'CLAIMED', ?, 1, '2026-01-01', '2026-01-01')", args: [`p${index}`, `Player ${index}`, `p${index}@pilot.test`, `hash-${index}`] },
      { sql: "INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game', ?, ?, 'batch')", args: [`p${index}`, role] },
    ], 'write');
  }
  await ensureGameRooms('game');
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('Moderator player choices', () => {
  test('shows every current choice in every phase, open Night actions included, with roles', async () => {
    await act('p5', 'day1', 'DAY_VOTE', ['p0']);
    // A changed vote replaces the earlier one.
    await act('p5', 'day1', 'DAY_VOTE', ['p3']);
    await act('p0', 'day1', 'DAY_VOTE', ['p3']);
    await phaseAction('day1', 'LOCK_AND_PROPOSE');
    await phaseAction('day1', 'PUBLISH');

    await exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('night2','game',2,'NIGHT','OPEN','2026-01-02','2099-01-01',1,30,'2026-01-02','2026-01-02')");
    await act('p0', 'night2', 'INVESTIGATE', ['p4']);
    await act('p1', 'night2', 'PROTECT', ['p5']);
    await act('p2', 'night2', 'CUPID_PAIR', ['p2', 'p5']);
    await act('p4', 'night2', 'WOLF_VOTE', ['p0']);

    const { status, phases } = await choices();
    expect(status).toBe(200);
    expect(phases.map((phase) => [phase.phaseId, phase.status])).toEqual([['night2', 'OPEN'], ['day1', 'PUBLISHED']]);

    const night = phases[0].choices.map((choice) => [choice.actorName, choice.actorRole, choice.label, choice.targets.map((target) => `${target.displayName} (${target.role})`).join(', ')]);
    expect(night).toEqual([
      ['Player 4', 'Werewolf', 'Pack target', 'Player 0 (Seer)'],
      ['Player 0', 'Seer', 'Investigated', 'Player 4 (Werewolf)'],
      ['Player 1', 'Bodyguard', 'Protected', 'Player 5 (Villager)'],
      ['Player 2', 'Cupid', 'Linked as lovers', 'Player 2 (Cupid), Player 5 (Villager)'],
    ]);
    const day = phases[1].choices.map((choice) => [choice.actorName, choice.targets.map((target) => target.displayName)]);
    expect(day).toEqual([['Player 0', ['Player 3']], ['Player 5', ['Player 3']]]);
  });

  test('leaves out phases from before a reset', async () => {
    await act('p5', 'day1', 'DAY_VOTE', ['p3']);
    await exec("INSERT INTO game_events (id,game_id,event_type,payload_json,created_at) VALUES ('reset','game','GAME_RESET','{}','2026-06-01')");
    expect((await choices()).phases).toEqual([]);
  });

  test('requires a moderator of this game', async () => {
    shared.moderatorError = { status: 401, message: 'Moderator authentication required.' };
    expect((await choices()).status).toBe(401);
    shared.moderatorError = { status: 403, message: 'You are not a moderator for this game.' };
    expect((await choices()).status).toBe(403);
  });
});
