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
  // Lets a test pause a route after one of its reads, to commit a competing write.
  gate: null as null | ((sql: string) => Promise<void>),
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth/session')>()),
  getCurrentModerator: async () => ({ id: 'mod', email: 'owner@pilot.test' }),
}));
vi.mock('../lib/auth/authorization', () => ({
  requireModerator: async () => ({ id: 'mod' }),
  requireGameModerator: async () => ({ id: 'mod' }),
  requireGameOwner: async () => ({ id: 'mod' }),
}));
// Phase-opened email is not under test.
vi.mock('../lib/notify/notifications', () => ({ notifyPhaseOpened: async () => {}, runAfterResponse: () => {} }));

import { PATCH as eliminationPatch } from '../app/api/games/[gameId]/elimination-schedule/route';
import { GET as phasesGet, POST as phasesPost } from '../app/api/games/[gameId]/phases/route';
import { PATCH as setupPatch } from '../app/api/games/[gameId]/schedule/route';
import { GET as gamesGet, POST as gamesPost } from '../app/api/games/route';

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
    const row = sqlite.prepare(this.sql).get(...this.args) as T | undefined;
    await shared.gate?.(this.sql);
    return row ?? null;
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

function request(body: Record<string, unknown>, method = 'POST'): Request {
  return new Request('http://localhost:3000/api/test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ gameId: 'game' }) };
const saveSchedule = (eliminationSchedule: unknown) => eliminationPatch(request({ eliminationSchedule }, 'PATCH'), params);
const openPhase = (kind: string) => phasesPost(request({ action: 'OPEN', kind, closesAt: '2099-01-01T12:00' }), params);
const setupSave = (body: Record<string, unknown>) => setupPatch(request(body, 'PATCH'), params);

const launchSchedule = {
  name: 'Watercooler',
  timezone: 'UTC',
  startDate: '2026-10-02',
  endDate: '2026-10-30',
  finalCutoffAt: '2026-10-30T16:00',
  activeWeekdays: [1, 2, 3, 4, 5],
  schedule: { dayCloses: '16:00', nightCloses: '09:00' },
};

const TWO_STAGES = [{ day: 2, night: 3, days: 1 }, { day: 1, night: 1, days: null }];

function setStatus(status: string): void {
  sqlite.prepare("UPDATE games SET status = ? WHERE id = 'game'").run(status);
}

function publishLatest(): void {
  sqlite.exec("UPDATE phases SET status = 'PUBLISHED' WHERE game_id = 'game' AND sequence = (SELECT MAX(sequence) FROM phases WHERE game_id = 'game')");
}

function phaseSlots(): Array<{ sequence: number; kind: string; slots: number }> {
  return sqlite.prepare("SELECT sequence, kind, slots FROM phases WHERE game_id = 'game' ORDER BY sequence").all() as Array<{ sequence: number; kind: string; slots: number }>;
}

function scheduleEvents(): Array<{ previous: unknown; schedule: unknown }> {
  return (sqlite.prepare("SELECT payload_json AS payload FROM game_events WHERE game_id = 'game' AND event_type = 'ELIMINATION_SCHEDULE_UPDATED' ORDER BY rowid").all() as Array<{ payload: string }>)
    .map((row) => JSON.parse(row.payload));
}

function storedSchedule(): unknown {
  const row = sqlite.prepare("SELECT elimination_schedule_json AS json FROM games WHERE id = 'game'").get() as { json: string | null };
  return row.json === null ? null : JSON.parse(row.json);
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of MIGRATION_FILES) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  shared.gate = null;
  shared.db = providerCompatible();
  sqlite.exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','review@pilot.test','fake','[]','2026-01-01','2026-01-01'); INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Review','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01'); INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01'); INSERT INTO assignment_batches (id,game_id,revision,setup_revision,roster_fingerprint,composition_fingerprint,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,1,'roster','composition','[]','hash','mod','2026-01-01');");
  for (let index = 0; index < 20; index += 1) {
    sqlite.prepare("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,'game',?,?,'CLAIMED',?,'2026-01-01','2026-01-01')").run('p' + index, 'Player ' + index, 'p' + index + '@pilot.test', 'hash' + index);
    sqlite.prepare("INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?,'batch')").run('p' + index, index > 16 ? 'WEREWOLF' : 'VILLAGER');
  }
});

afterEach(() => sqlite.close());

describe('elimination schedule during setup', () => {
  test('an existing game in setup saves a schedule from the schedule form, lists it, and audits before and after', async () => {
    expect(storedSchedule()).toBeNull();
    const saved = await setupSave({ ...launchSchedule, eliminationSchedule: JSON.stringify(TWO_STAGES) });
    expect(saved.status).toBe(200);
    expect(storedSchedule()).toEqual(TWO_STAGES);
    const listed = await (await gamesGet(new Request('http://localhost:3000/api/games'))).json() as { games: Array<Record<string, unknown>> };
    expect(listed.games.find((game) => game.id === 'game')).toMatchObject({ eliminationSchedule: TWO_STAGES, dayDivisor: 30, nightDivisor: 30 });

    // Saving the form again without a change adds no schedule entry; an empty field removes the schedule.
    expect((await setupSave({ ...launchSchedule, eliminationSchedule: JSON.stringify(TWO_STAGES) })).status).toBe(200);
    expect((await setupSave({ ...launchSchedule, eliminationSchedule: '' })).status).toBe(200);
    expect(storedSchedule()).toBeNull();
    expect(scheduleEvents()).toEqual([
      expect.objectContaining({ previous: null, schedule: TWO_STAGES }),
      expect.objectContaining({ previous: TWO_STAGES, schedule: null }),
    ]);
  });

  test('a form or script that leaves the field out keeps the schedule', async () => {
    await saveSchedule(TWO_STAGES);
    expect((await setupSave(launchSchedule)).status).toBe(200);
    expect(storedSchedule()).toEqual(TWO_STAGES);
  });

  test('an invalid schedule is refused in plain language and nothing changes', async () => {
    const response = await setupSave({ ...launchSchedule, name: 'Renamed', eliminationSchedule: [{ day: 0, night: 1, days: 3 }, { day: 1, night: 1 }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Stage 1: Day eliminations must be a whole number from 1 to 79.' });
    expect(storedSchedule()).toBeNull();
    expect((sqlite.prepare("SELECT name FROM games WHERE id = 'game'").get() as { name: string }).name).toBe('Review');
    expect((await saveSchedule([{ day: 1, night: 1, days: 0 }, { day: 1, night: 1 }])).status).toBe(400);
  });

  test('a new game can start with a schedule', async () => {
    const created = await gamesPost(request({ ...launchSchedule, eliminationSchedule: JSON.stringify(TWO_STAGES) }));
    expect(created.status).toBe(201);
    const { gameId } = await created.json() as { gameId: string };
    const row = sqlite.prepare('SELECT elimination_schedule_json AS json FROM games WHERE id = ?').get(gameId) as { json: string };
    expect(JSON.parse(row.json)).toEqual(TWO_STAGES);
  });
});

describe('elimination schedule in play', () => {
  test('without a schedule, phases keep the divisor formula', async () => {
    sqlite.exec("UPDATE games SET status = 'ACTIVE', day_divisor = 10, night_divisor = 7 WHERE id = 'game'");
    expect((await openPhase('DAY')).status).toBe(200);
    publishLatest();
    expect((await openPhase('NIGHT')).status).toBe(200);
    // 20 living: ceil(20 / 10) = 2 by Day and ceil(20 / 7) = 3 by Night.
    expect(phaseSlots()).toEqual([{ sequence: 1, kind: 'DAY', slots: 2 }, { sequence: 2, kind: 'NIGHT', slots: 3 }]);
  });

  test('phases opened across a stage boundary record each stage’s slots', async () => {
    await saveSchedule(TWO_STAGES);
    setStatus('ACTIVE');
    for (const kind of ['DAY', 'NIGHT', 'DAY', 'NIGHT', 'DAY']) {
      const response = await openPhase(kind);
      expect(response.status).toBe(200);
      publishLatest();
    }
    expect(phaseSlots().map((phase) => phase.slots)).toEqual([2, 3, 1, 1, 1]);
  });

  test('a phase never eliminates every living player', async () => {
    await saveSchedule([{ day: 5, night: 5, days: null }]);
    setStatus('ACTIVE');
    sqlite.exec("UPDATE seats SET alive = 0 WHERE game_id = 'game' AND id NOT IN ('p0', 'p1', 'p17')");
    expect(await (await openPhase('DAY')).json()).toMatchObject({ slots: 2 });
  });

  test('a mid-game change leaves the open phase and earlier phases alone and applies from the next phase', async () => {
    await saveSchedule(TWO_STAGES);
    setStatus('ACTIVE');
    expect((await openPhase('DAY')).status).toBe(200);
    publishLatest();
    expect((await openPhase('NIGHT')).status).toBe(200);

    const changed = [{ day: 4, night: 4, days: null }];
    const response = await saveSchedule(changed);
    expect(response.status).toBe(200);
    // Day 1 (published) and Night 1 (open) keep the slots they recorded.
    expect(phaseSlots().map((phase) => phase.slots)).toEqual([2, 3]);
    expect(scheduleEvents().at(-1)).toMatchObject({ previous: TWO_STAGES, schedule: changed, status: 'ACTIVE' });

    // The console sees the new schedule.
    const console = await (await phasesGet(new Request('http://localhost:3000/api/games/game/phases'), params)).json() as { game: Record<string, unknown> };
    expect(console.game).toMatchObject({ eliminationSchedule: changed });
    expect(console.game).not.toHaveProperty('eliminationScheduleJson');

    publishLatest();
    expect((await openPhase('DAY')).status).toBe(200);
    expect(phaseSlots().map((phase) => phase.slots)).toEqual([2, 3, 4]);
  });

  test('the schedule stays editable in final showdown and locks once the game is over', async () => {
    setStatus('FINAL_SHOWDOWN');
    expect((await saveSchedule(TWO_STAGES)).status).toBe(200);
    for (const status of ['COMPLETED', 'STOPPED', 'CANCELLED']) {
      setStatus(status);
      const response = await saveSchedule([{ day: 1, night: 1, days: null }]);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('finished, stopped, or cancelled') });
    }
    expect(storedSchedule()).toEqual(TWO_STAGES);
  });

  test('the divisors and other setup settings stay locked after release', async () => {
    setStatus('ACTIVE');
    const response = await setupSave({ ...launchSchedule, dayDivisor: 5, eliminationSchedule: JSON.stringify(TWO_STAGES) });
    expect(response.status).toBe(400);
    expect(storedSchedule()).toBeNull();
    expect((sqlite.prepare("SELECT day_divisor AS divisor FROM games WHERE id = 'game'").get() as { divisor: number }).divisor).toBe(30);
  });

  test('a request must name the schedule; null removes it', async () => {
    await saveSchedule(TWO_STAGES);
    expect((await eliminationPatch(request({}, 'PATCH'), params)).status).toBe(400);
    expect(storedSchedule()).toEqual(TWO_STAGES);
    expect((await saveSchedule(null)).status).toBe(200);
    expect(storedSchedule()).toBeNull();
  });

  test('a schedule saved while a phase is opening makes the opening answer 409, and a retry uses the new schedule', async () => {
    await saveSchedule(TWO_STAGES);
    setStatus('ACTIVE');
    let release!: () => void;
    let reached!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    // Pause the phase opening right after it reads the living count, which follows its read of the schedule.
    shared.gate = async (sql) => {
      if (!sql.includes('alive = 1')) return;
      shared.gate = null;
      reached();
      await blocked;
    };
    const opening = openPhase('DAY');
    await paused;
    const changed = [{ day: 3, night: 1, days: null }];
    expect((await saveSchedule(changed)).status).toBe(200);
    release();
    const response = await opening;
    expect(response.status).toBe(409);
    expect(phaseSlots()).toEqual([]);

    expect(await (await openPhase('DAY')).json()).toMatchObject({ slots: 3 });
  });

  test('a schedule save that loses a race with another game change answers 409', async () => {
    let release!: () => void;
    let reached!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const paused = new Promise<void>((resolve) => { reached = resolve; });
    shared.gate = async (sql) => {
      if (!sql.includes('elimination_schedule_json AS eliminationScheduleJson FROM games')) return;
      shared.gate = null;
      reached();
      await blocked;
    };
    const saving = saveSchedule(TWO_STAGES);
    await paused;
    sqlite.exec("UPDATE games SET status = 'ACTIVE', updated_at = '2026-10-02T00:00:00.000Z' WHERE id = 'game'");
    release();
    expect((await saving).status).toBe(409);
    expect(storedSchedule()).toBeNull();
    expect(scheduleEvents()).toEqual([]);
  });
});
