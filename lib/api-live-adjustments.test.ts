import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MIGRATION_FILES } from '../scripts/db-migration-runner.mjs';

interface TestStatement {
  readonly sql: string;
  getArgs(): SQLInputValue[];
}

interface TestDatabase {
  prepare(sql: string): TestStatement;
  batch(statements: TestStatement[]): Promise<unknown>;
}

const shared = vi.hoisted(() => ({
  db: null as TestDatabase | null,
  currentPlayer: null as { seatId: string; gameId: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({
  requireModerator: async () => ({ id: 'mod' }),
  requireGameModerator: async () => ({ id: 'mod' }),
  requireGameOwner: async () => ({ id: 'mod' }),
}));
vi.mock('../lib/auth/session', () => ({
  createPlayerSession: async () => {},
  preparePlayerSession: async (seatId: string, sessionVersion: number) => ({
    values: [crypto.randomUUID(), seatId, `token-${crypto.randomUUID()}`, sessionVersion, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => {},
  }),
  getCurrentPlayer: async () => shared.currentPlayer,
  getCurrentSpectator: async () => null,
}));
vi.mock('../lib/http/rate-limit', () => {
  class TestRateLimitError extends Error {
    readonly retryAfterSeconds = 1;
  }
  return { enforceRateLimit: async () => {}, requestRateLimitKey: () => 'live-adjustments-test', RateLimitError: TestRateLimitError };
});
// Phase-opened email is not under test.
vi.mock('../lib/notify/notifications', () => ({ notifyPhaseOpened: async () => {}, runAfterResponse: () => {} }));

import { POST as lateVillagerPost } from '../app/api/games/[gameId]/late-villagers/route';
import { GET as phasesGet, POST as phasesPost } from '../app/api/games/[gameId]/phases/route';
import { POST as claimPost } from '../app/api/seats/claim/[code]/route';
import { GET as playerGet } from '../app/api/player/route';
import { ensureGameRooms } from './chat/rooms';

let sqlite: DatabaseSync;

class ProviderStatement {
  private args: SQLInputValue[] = [];

  constructor(readonly sql: string) {}

  bind(...args: SQLInputValue[]): this {
    this.args = args;
    return this;
  }

  getArgs(): SQLInputValue[] {
    return this.args;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (sqlite.prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: sqlite.prepare(this.sql).all(...this.args) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = sqlite.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes) } };
  }
}

function providerCompatible(): TestDatabase {
  return {
    prepare: (sql) => new ProviderStatement(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => {
          // A read batch, as the player dashboard sends, answers with rows.
          if (/^\s*SELECT\b/u.test(statement.sql)) return { results: sqlite.prepare(statement.sql).all(...statement.getArgs()) };
          const result = sqlite.prepare(statement.sql).run(...statement.getArgs());
          return { meta: { changes: Number(result.changes) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function request(body: Record<string, unknown>, path = '/api/test'): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ gameId: 'game' }) };
const addLate = (displayName: string, email: string) => lateVillagerPost(request({ displayName, email }), params);
const openPhase = (kind: string, closesAt = '2099-01-01T12:00') => phasesPost(request({ action: 'OPEN', kind, closesAt }), params);
const extend = (phaseId: string, closesAt: string) => phasesPost(request({ action: 'EXTEND_DEADLINE', phaseId, closesAt }), params);

function publishLatest(): void {
  sqlite.exec("UPDATE phases SET status = 'PUBLISHED' WHERE game_id = 'game' AND sequence = (SELECT MAX(sequence) FROM phases WHERE game_id = 'game')");
}

function openPhaseRow(): { id: string; closesAt: string; closingReminderAt: string | null } {
  return sqlite.prepare("SELECT id, closes_at AS closesAt, closing_reminder_at AS closingReminderAt FROM phases WHERE game_id = 'game' AND status = 'OPEN'").get() as { id: string; closesAt: string; closingReminderAt: string | null };
}

function villagerCount(): number {
  return Number((sqlite.prepare("SELECT count FROM game_role_counts WHERE game_id = 'game' AND role_key = 'VILLAGER'").get() as { count: number }).count);
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of MIGRATION_FILES) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  shared.db = providerCompatible();
  shared.currentPlayer = null;
  sqlite.exec(`INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','review@pilot.test','fake','[]','2026-01-01','2026-01-01');
    INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at)
      VALUES ('game','Review','ACTIVE','America/Regina','2026-01-01','2027-01-01','[1,2,3,4,5]','{"dayCloses":"16:00","nightCloses":"09:00"}','2099-01-01','mod','2026-01-01','2026-01-01');
    INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01');
    INSERT INTO assignment_batches (id,game_id,revision,setup_revision,roster_fingerprint,composition_fingerprint,assignments_json,random_evidence_hash,released_at,created_by_moderator_id,created_at)
      VALUES ('batch','game',1,1,'roster','composition','[]','hash','2026-01-01','mod','2026-01-01');
    INSERT INTO game_role_counts (game_id,role_key,count,power_snapshot) VALUES ('game','VILLAGER',17,0), ('game','WEREWOLF',3,0);`);
  for (let index = 0; index < 20; index += 1) {
    sqlite.prepare("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,'game',?,?,'CLAIMED',?,'2026-01-01','2026-01-01')").run('p' + index, 'Player ' + index, 'p' + index + '@pilot.test', 'hash' + index);
    sqlite.prepare("INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?,'batch')").run('p' + index, index > 16 ? 'WEREWOLF' : 'VILLAGER');
  }
  // A seat removed before roles were randomized: its email was archived.
  sqlite.exec("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,alive,created_at,updated_at) VALUES ('gone','game','Late Lee','archived+gone@invalid.test','REMOVED','old-hash',0,'2026-01-01','2026-01-01')");
});

afterEach(() => sqlite.close());

describe('late Villagers', () => {
  test('a late joiner is added quietly as a Villager, claims the seat, and plays', async () => {
    expect((await openPhase('DAY')).status).toBe(200);
    const added = await addLate('Late Lee', 'Lee@Late.test');
    expect(added.status).toBe(200);
    const body = await added.json() as { seat: { id: string; role: string }; claimUrl: string; inviteCode: string };
    expect(body.seat.role).toBe('VILLAGER');
    expect(body.claimUrl).toBe(`http://localhost:3000/claim/${encodeURIComponent(body.inviteCode)}`);

    expect(sqlite.prepare('SELECT status, email, alive FROM seats WHERE id = ?').get(body.seat.id)).toEqual({ status: 'INVITED', email: 'lee@late.test', alive: 1 });
    expect(sqlite.prepare('SELECT role_key AS role, assignment_batch_id AS batch FROM role_assignments WHERE seat_id = ?').get(body.seat.id)).toEqual({ role: 'VILLAGER', batch: 'batch' });
    expect(villagerCount()).toBe(18);
    // Moderator-only audit; nothing is announced to players.
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'LATE_VILLAGER_ADDED'").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM announcements WHERE game_id = 'game'").get()).toEqual({ count: 0 });

    // Unclaimed, the seat is not yet in the moderator's roster or anyone's count.
    const before = await (await phasesGet(new Request('http://localhost:3000/api/games/game/phases'), params)).json() as { roster: unknown[] };
    expect(before.roster).toHaveLength(20);

    // The rooms were made at release; the unclaimed seat is in none of them.
    await ensureGameRooms('game');
    const townHall = () => sqlite.prepare("SELECT crm.access FROM chat_room_members crm JOIN chat_rooms cr ON cr.id = crm.room_id WHERE cr.type = 'TOWN_HALL' AND crm.seat_id = ?").all(body.seat.id);
    expect(townHall()).toEqual([]);
    const claim = await claimPost(request({ pin: '135790' }, `/api/seats/claim/${body.inviteCode}`), { params: Promise.resolve({ code: body.inviteCode }) });
    expect(claim.status).toBe(200);
    // Claiming joins the Town Hall at once, without waiting for the next publish.
    expect(townHall()).toEqual([{ access: 'WRITE' }]);
    shared.currentPlayer = { seatId: body.seat.id, gameId: 'game' };
    const view = await (await playerGet(new Request('http://localhost:3000/api/player'))).json() as {
      player: { role: string; alive: boolean };
      game: { counts: { total: number; living: number; werewolvesRemaining: number } };
      phase: { kind: string; status: string } | null;
    };
    expect(view.player).toMatchObject({ role: 'VILLAGER', alive: true });
    expect(view.game.counts).toEqual({ total: 21, living: 21, werewolvesRemaining: 3 });
    expect(view.phase).toMatchObject({ kind: 'DAY', status: 'OPEN' });
  });

  test('allowed through the first Night, refused once the second Day opens', async () => {
    await openPhase('DAY');
    publishLatest();
    await openPhase('NIGHT');
    expect((await addLate('Night Owl', 'owl@late.test')).status).toBe(200);
    publishLatest();
    await openPhase('DAY');
    const refused = await addLate('Too Late', 'too@late.test');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'Late Villagers can be added only during the first Day and Night.' });
    expect(villagerCount()).toBe(18);
  });

  test('refuses a duplicate player email, a spectator\'s email, and a game that is not running', async () => {
    expect((await addLate('Copy', 'p3@pilot.test')).status).toBe(409);
    sqlite.exec("INSERT INTO spectators (id,game_id,display_name,email,status,claim_code_hash,session_version,added_by_moderator_id,created_at,updated_at) VALUES ('s1','game','Watcher','watch@late.test','ACTIVE','spec-hash',1,'mod','2026-01-01','2026-01-01')");
    const spectator = await addLate('Watcher', 'watch@late.test');
    expect(spectator.status).toBe(409);
    expect(await spectator.json()).toMatchObject({ error: expect.stringMatching(/Remove them from Spectators first/u) });
    sqlite.exec("UPDATE games SET status = 'STOPPED' WHERE id = 'game'");
    expect((await addLate('Stopped', 'stop@late.test')).status).toBe(409);
    expect(villagerCount()).toBe(17);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM seats WHERE status = 'INVITED'").get()).toEqual({ count: 0 });
  });
});

describe('extending a deadline', () => {
  test('moves an open phase\'s deadline later in the game timezone, audits it, and re-arms the reminder', async () => {
    await openPhase('DAY', '2099-01-01T11:14');
    const phase = openPhaseRow();
    expect(phase.closesAt).toBe('2099-01-01T17:14:00.000Z');
    sqlite.prepare("UPDATE phases SET closing_reminder_at = '2099-01-01T16:15:00.000Z' WHERE id = ?").run(phase.id);

    const response = await extend(phase.id, '2099-01-01T16:00');
    expect(response.status).toBe(200);
    expect(openPhaseRow()).toEqual({ id: phase.id, closesAt: '2099-01-01T22:00:00.000Z', closingReminderAt: null });
    const event = sqlite.prepare("SELECT payload_json AS payload FROM game_events WHERE event_type = 'PHASE_DEADLINE_EXTENDED'").get() as { payload: string };
    expect(JSON.parse(event.payload)).toEqual({ from: '2099-01-01T17:14:00.000Z', to: '2099-01-01T22:00:00.000Z' });
  });

  test('never moves a deadline earlier, and refuses once voting has closed', async () => {
    await openPhase('DAY', '2099-01-01T16:00');
    const phase = openPhaseRow();
    const earlier = await extend(phase.id, '2099-01-01T12:00');
    expect(earlier.status).toBe(400);
    expect(await earlier.json()).toMatchObject({ error: expect.stringMatching(/later than the current one/u) });

    sqlite.prepare("UPDATE phases SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(phase.id);
    const closed = await extend(phase.id, '2099-01-02T16:00');
    expect(closed.status).toBe(400);
    expect(await closed.json()).toMatchObject({ error: expect.stringMatching(/already closed/u) });
    expect(openPhaseRow().closesAt).toBe('2020-01-01T00:00:00.000Z');
  });

  test('the console receives the game\'s Day and Night close times for the default deadline', async () => {
    const body = await (await phasesGet(new Request('http://localhost:3000/api/games/game/phases'), params)).json() as { game: Record<string, unknown> };
    expect(body.game.schedule).toEqual({ dayCloses: '16:00', nightCloses: '09:00', activeWeekdays: [1, 2, 3, 4, 5] });
    expect(body.game).not.toHaveProperty('scheduleJson');
  });
});
