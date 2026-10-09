import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { providerDatabase, type TestDatabase } from './test-support/provider-database';
import { readFileSync } from 'node:fs';
import { defaultComposition } from './game/balance';
import { sha256 } from './auth/crypto';

const shared = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({
  requireGameModerator: async () => ({ id: 'mod' }),
  requireGameOwner: async () => ({ id: 'mod' }),
}));

import { POST as assignmentPost } from '../app/api/games/[gameId]/assignments/route';
import { POST as seatsPost } from '../app/api/games/[gameId]/seats/route';
import { DELETE as seatDelete } from '../app/api/games/[gameId]/seats/[seatId]/route';

let sqlite: DatabaseSync;

function request(method: string, body?: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function assignments(body: Record<string, unknown>): Promise<Response> {
  return assignmentPost(request('POST', body), { params: Promise.resolve({ gameId: 'game' }) });
}

function addSeat(body: Record<string, unknown>): Promise<Response> {
  return seatsPost(request('POST', body), { params: Promise.resolve({ gameId: 'game' }) });
}

function removeSeat(seatId: string): Promise<Response> {
  return seatDelete(request('DELETE'), { params: Promise.resolve({ gameId: 'game', seatId }) });
}

function seedSetupGame(playerCount = 20, invited = 2): void {
  for (const file of ['0000_dashing_smiling_tiger.sql', '0001_bodyguard_and_lifecycle.sql', '0002_pilot_hardening.sql', '0003_reviewed_outcome.sql', '0012_sign_ups_and_moderator_applications.sql']) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  sqlite.exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','review@pilot.test','fake','[]','2026-01-01','2026-01-01'); INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Review','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01'); INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01');");
  for (const [role, count] of Object.entries(defaultComposition(playerCount))) {
    sqlite.prepare('INSERT INTO game_role_counts (game_id,role_key,count,power_snapshot) VALUES (?,?,?,0)').run('game', role, count);
  }
  // The first `invited` players have not claimed their seats yet.
  for (let index = 0; index < playerCount; index += 1) {
    sqlite.prepare('INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,\'game\',?,?,?,?,\'2026-01-01\',\'2026-01-01\')')
      .run('p' + index, 'Player ' + index, 'p' + index + '@pilot.test', index < invited ? 'INVITED' : 'CLAIMED', 'hash' + index);
  }
}

function resetSetupGame(playerCount: number, invited: number): void {
  sqlite.close();
  sqlite = new DatabaseSync(':memory:');
  seedSetupGame(playerCount, invited);
  shared.db = providerDatabase(sqlite);
}

function roleCounts(): Record<string, number> {
  const rows = sqlite.prepare("SELECT role_key AS roleKey, count FROM game_role_counts WHERE game_id = 'game'").all() as Array<{ roleKey: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.roleKey, Number(row.count)]));
}

function activeSeatCount(): number {
  return Number((sqlite.prepare("SELECT COUNT(*) AS count FROM seats WHERE game_id = 'game' AND status != 'REMOVED'").get() as { count: number }).count);
}

function revision(): number {
  return Number((sqlite.prepare("SELECT setup_revision AS revision FROM games WHERE id = 'game'").get() as { revision: number }).revision);
}

function events(type: string): Array<{ payloadJson: string; moderatorId: string }> {
  return sqlite.prepare('SELECT payload_json AS payloadJson, actor_moderator_id AS moderatorId FROM game_events WHERE event_type = ?').all(type) as Array<{ payloadJson: string; moderatorId: string }>;
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  seedSetupGame();
  shared.db = providerDatabase(sqlite);
});

afterEach(() => sqlite.close());

describe('adding and removing single seats before roles are randomized', () => {
  test('adding a player creates an unclaimed seat, adds a Villager, and is audited', async () => {
    const response = await addSeat({ displayName: '  Late Joiner ', email: 'Late@Pilot.test' });
    expect(response.status).toBe(200);
    const data = await response.json() as { seat: { id: string }; claimUrl: string; inviteCode: string; playerCount: number; resetToPreset: boolean };
    expect(data).toMatchObject({ playerCount: 21, resetToPreset: false, seat: { displayName: 'Late Joiner', email: 'late@pilot.test', status: 'INVITED' } });
    expect(data.claimUrl).toBe(`http://localhost:3000/claim/${encodeURIComponent(data.inviteCode)}`);
    const seat = sqlite.prepare('SELECT status, claim_code_hash AS hash FROM seats WHERE id = ?').get(data.seat.id) as { status: string; hash: string };
    expect(seat).toEqual({ status: 'INVITED', hash: await sha256(data.inviteCode) });
    expect(activeSeatCount()).toBe(21);
    expect(roleCounts()).toEqual({ ...defaultComposition(20), VILLAGER: defaultComposition(20).VILLAGER + 1 });
    expect(revision()).toBe(2);
    expect(events('SEAT_ADDED')).toHaveLength(1);
    expect(events('SEAT_ADDED')[0].moderatorId).toBe('mod');
    expect(JSON.parse(events('SEAT_ADDED')[0].payloadJson)).toMatchObject({ seatId: data.seat.id, playerCount: 21, compositionReset: false });
  });

  test('adding a player keeps custom role counts', async () => {
    const custom = { VILLAGER: 10, WEREWOLF: 4, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 2, MAYOR: 1 };
    expect((await assignments({ action: 'SAVE_COMPOSITION', composition: custom })).status).toBe(200);
    expect((await addSeat({ displayName: 'Late Joiner', email: 'late@pilot.test' })).status).toBe(200);
    expect(roleCounts()).toMatchObject({ ...custom, VILLAGER: 11 });
  });

  test('an invalid or duplicate player changes nothing', async () => {
    expect((await addSeat({ displayName: '', email: 'late@pilot.test' })).status).toBe(400);
    expect((await addSeat({ displayName: 'Two', email: 'a@pilot.test;b@pilot.test' })).status).toBe(400);
    const duplicate = await addSeat({ displayName: 'Copy', email: 'P3@pilot.test' });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: expect.stringContaining('already on the roster') });
    expect(activeSeatCount()).toBe(20);
    expect(revision()).toBe(1);
  });

  test('a removed player\'s email can be added back', async () => {
    expect((await removeSeat('p0')).status).toBe(200);
    expect((await addSeat({ displayName: 'Player 0', email: 'p0@pilot.test' })).status).toBe(200);
    expect(activeSeatCount()).toBe(20);
  });

  test('removing an unclaimed player archives the seat, removes a Villager, and is audited', async () => {
    const response = await removeSeat('p1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ playerCount: 19, resetToPreset: false });
    const seat = sqlite.prepare("SELECT status, email, claim_code_hash AS hash FROM seats WHERE id = 'p1'").get() as { status: string; email: string; hash: string };
    expect(seat.status).toBe('REMOVED');
    expect(seat.email).toBe('archived+p1@invalid.test');
    expect(seat.hash).not.toBe('hash1');
    expect(activeSeatCount()).toBe(19);
    expect(roleCounts().VILLAGER).toBe(defaultComposition(20).VILLAGER - 1);
    expect(JSON.parse(events('SEAT_REMOVED')[0].payloadJson)).toMatchObject({ seatId: 'p1', playerCount: 19 });
  });

  test('once the two no-shows are removed, the rest can randomize', async () => {
    expect((await assignments({ action: 'PREVIEW' })).status).toBe(400);
    expect((await removeSeat('p0')).status).toBe(200);
    expect((await removeSeat('p1')).status).toBe(200);
    expect((await assignments({ action: 'PREVIEW' })).status).toBe(200);
  });

  test('a claimed player cannot be removed', async () => {
    const response = await removeSeat('p5');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('not claimed') });
    expect(activeSeatCount()).toBe(20);
  });

  test('an unknown or already removed seat is not found', async () => {
    expect((await removeSeat('nobody')).status).toBe(404);
    expect((await removeSeat('p0')).status).toBe(200);
    expect((await removeSeat('p0')).status).toBe(404);
  });

  test('the roster cannot drop below the minimum or grow past the maximum', async () => {
    resetSetupGame(6, 6);
    expect((await removeSeat('p0')).status).toBe(409);
    resetSetupGame(80, 0);
    expect((await addSeat({ displayName: 'One Too Many', email: 'extra@pilot.test' })).status).toBe(409);
  });

  test('when no Villager is left to remove, the counts reset to the preset', async () => {
    resetSetupGame(8, 1);
    expect((await assignments({ action: 'SAVE_COMPOSITION', composition: { WEREWOLF: 2, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 2, CUPID: 1 } })).status).toBe(200);
    const response = await removeSeat('p0');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resetToPreset: true, composition: defaultComposition(7) });
    expect(roleCounts()).toEqual(defaultComposition(7));
  });

  test('the roster locks once roles are randomized and reopens when the composition is saved again', async () => {
    resetSetupGame(20, 0);
    const preview = await assignments({ action: 'PREVIEW' });
    expect(preview.status).toBe(200);
    const added = await addSeat({ displayName: 'Late Joiner', email: 'late@pilot.test' });
    expect(added.status).toBe(409);
    expect(await added.json()).toMatchObject({ error: expect.stringContaining('randomized') });
    expect(activeSeatCount()).toBe(20);

    expect((await assignments({ action: 'SAVE_COMPOSITION', composition: defaultComposition(20) })).status).toBe(200);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM assignment_batches').get() as { count: number }).count).toBe(0);
    expect((await addSeat({ displayName: 'Late Joiner', email: 'late@pilot.test' })).status).toBe(200);
  });

  test('no one can be added or removed after roles are released', async () => {
    resetSetupGame(20, 0);
    const preview = await assignments({ action: 'PREVIEW' });
    const { batchId } = await preview.json() as { batchId: string };
    expect((await assignments({ action: 'RELEASE', batchId })).status).toBe(200);
    expect((await addSeat({ displayName: 'Late Joiner', email: 'late@pilot.test' })).status).toBe(409);
    expect((await removeSeat('p0')).status).toBe(409);
    expect(activeSeatCount()).toBe(20);
  });

  test('a player who claims while being removed keeps their seat', async () => {
    const provider = shared.db!;
    shared.db = {
      prepare: provider.prepare,
      batch: async (statements) => {
        sqlite.exec("UPDATE seats SET status = 'CLAIMED' WHERE id = 'p0'");
        return provider.batch(statements);
      },
    };
    const response = await removeSeat('p0');
    expect(response.status).toBe(409);
    expect((sqlite.prepare("SELECT status FROM seats WHERE id = 'p0'").get() as { status: string }).status).toBe('CLAIMED');
    expect(roleCounts()).toEqual(defaultComposition(20));
    expect(revision()).toBe(1);
    expect(events('SEAT_REMOVED')).toHaveLength(0);
  });

  test('a concurrent roster change makes a stale add change nothing', async () => {
    const provider = shared.db!;
    shared.db = {
      prepare: provider.prepare,
      batch: async (statements) => {
        sqlite.exec("UPDATE games SET status = 'ASSIGNMENT_PREVIEW'");
        return provider.batch(statements);
      },
    };
    expect((await addSeat({ displayName: 'Late Joiner', email: 'late@pilot.test' })).status).toBe(409);
    expect(activeSeatCount()).toBe(20);
    expect(roleCounts()).toEqual(defaultComposition(20));
  });
});
