import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { defaultComposition } from './game/balance';

interface TestStatement {
  readonly sql: string;
  getArgs(): SQLInputValue[];
}

interface TestDatabase {
  prepare(sql: string): TestStatement;
  batch(statements: TestStatement[]): Promise<unknown>;
}

const shared = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/chat/rooms', () => ({ ensureGameRooms: async () => {} }));

import { POST as assignmentPost } from '../app/api/games/[gameId]/assignments/route';
import { POST as rosterPost } from '../app/api/games/[gameId]/roster/route';
import { GET as phaseGet, POST as phasePost } from '../app/api/games/[gameId]/phases/route';

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

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function assignments(body: Record<string, unknown>): Promise<Response> {
  return assignmentPost(request(body), { params: Promise.resolve({ gameId: 'game' }) });
}

function phases(body: Record<string, unknown>): Promise<Response> {
  return phasePost(request(body), { params: Promise.resolve({ gameId: 'game' }) });
}

function providerCompatible(): TestDatabase {
  return {
    prepare: (sql) => new ProviderStatement(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results: Array<{ meta: { changes: number } } | { results: unknown[] }> = [];
        for (const statement of statements) {
          if (/^\s*SELECT\b/u.test(statement.sql)) {
            results.push({ results: sqlite.prepare(statement.sql).all(...statement.getArgs()) });
          } else {
            const result = sqlite.prepare(statement.sql).run(...statement.getArgs());
            results.push({ meta: { changes: Number(result.changes) } });
          }
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function seedSetupGame(): void {
  for (const file of ['0000_dashing_smiling_tiger.sql', '0001_bodyguard_and_lifecycle.sql', '0002_pilot_hardening.sql', '0003_reviewed_outcome.sql']) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  sqlite.exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','review@pilot.test','fake','[]','2026-01-01','2026-01-01'); INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Review','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01'); INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01');");
  const composition = defaultComposition(20);
  for (const [role, count] of Object.entries(composition)) {
    sqlite.prepare('INSERT INTO game_role_counts (game_id,role_key,count,power_snapshot) VALUES (?,?,?,0)').run('game', role, count);
  }
  for (let index = 0; index < 20; index += 1) {
    sqlite.prepare("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,'game',?,?,'CLAIMED',?,'2026-01-01','2026-01-01')").run('p' + index, 'Player ' + index, 'p' + index + '@pilot.test', 'hash' + index);
  }
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  seedSetupGame();
  shared.db = providerCompatible();
});

afterEach(() => sqlite.close());

describe('setup and publication invariants', () => {
  test('a roster replacement records its audit event and returns to registration', async () => {
    const csv = ['display_name,email', ...Array.from({ length: 20 }, (_, index) => `New Player ${index},new${index}@pilot.test`)].join('\n');
    const response = await rosterPost(request({ csv }), { params: Promise.resolve({ gameId: 'game' }) });
    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT status, setup_revision AS revision FROM games WHERE id = 'game'").get()).toMatchObject({ status: 'REGISTRATION', revision: 2 });
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM seats WHERE game_id = 'game' AND status = 'INVITED'").get() as { count: number }).count).toBe(20);
    const events = sqlite.prepare("SELECT game_id AS gameId, actor_moderator_id AS moderatorId, payload_json AS payloadJson FROM game_events WHERE event_type = 'ROSTER_IMPORTED'").all() as Array<{ gameId: string; moderatorId: string; payloadJson: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ gameId: 'game', moderatorId: 'mod' });
    expect(JSON.parse(events[0].payloadJson)).toEqual({ playerCount: 20 });
  });

  test('a composition change invalidates an old preview before release', async () => {
    const original = await assignments({ action: 'PREVIEW' });
    expect(original.status).toBe(200);
    const originalData = await original.json() as { batchId: string };

    const saved = await assignments({
      action: 'SAVE_COMPOSITION',
      composition: { VILLAGER: 11, WEREWOLF: 4, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 2 },
    });
    expect(saved.status).toBe(200);
    const staleRelease = await assignments({ action: 'RELEASE', batchId: originalData.batchId });
    expect(staleRelease.status).toBe(400);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM role_assignments').get() as { count: number }).count).toBe(0);

    const current = await assignments({ action: 'PREVIEW' });
    expect(current.status).toBe(200);
    const currentData = await current.json() as { batchId: string };
    expect((await assignments({ action: 'RELEASE', batchId: currentData.batchId })).status).toBe(200);
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM role_assignments WHERE game_id = 'game' AND role_key = 'WEREWOLF'").get() as { count: number }).count).toBe(4);
    expect((sqlite.prepare('SELECT status FROM games WHERE id = \'game\'').get() as { status: string }).status).toBe('ACTIVE');
  });

  test('a stopped setup game cannot be reactivated by release', async () => {
    const preview = await assignments({ action: 'PREVIEW' });
    const data = await preview.json() as { batchId: string };
    sqlite.exec("UPDATE games SET status = 'STOPPED'");
    const release = await assignments({ action: 'RELEASE', batchId: data.batchId });
    expect(release.status).toBe(400);
    expect((sqlite.prepare('SELECT status FROM games WHERE id = \'game\'').get() as { status: string }).status).toBe('STOPPED');
  });

  test('an override that selects a Hunter creates the required response window', async () => {
    const preview = await assignments({ action: 'PREVIEW' });
    const previewData = await preview.json() as { batchId: string; assignments: Array<{ seatId: string; role: string }> };
    expect((await assignments({ action: 'RELEASE', batchId: previewData.batchId })).status).toBe(200);
    const hunterId = previewData.assignments.find((assignment) => assignment.role === 'HUNTER')?.seatId;
    expect(hunterId).toBeTruthy();

    const opened = await phases({ action: 'OPEN', kind: 'DAY', closesAt: '2099-01-01T00:00Z' });
    const openedData = await opened.json() as { phaseId: string };
    expect(opened.status).toBe(200);
    expect((await phases({ action: 'LOCK_AND_PROPOSE', phaseId: openedData.phaseId })).status).toBe(200);
    const overridden = await phases({ action: 'PUBLISH', phaseId: openedData.phaseId, overrideEliminationIds: [hunterId], overrideReason: 'Controlled Hunter follow-up test' });
    expect(overridden.status).toBe(200);
    expect((await overridden.json() as { pendingHunter: boolean }).pendingHunter).toBe(true);
    const state = sqlite.prepare('SELECT status FROM phases WHERE id = ?').get(openedData.phaseId) as { status: string };
    expect(state.status).toBe('PENDING_HUNTER');
    const proposal = sqlite.prepare('SELECT outcome_json AS outcomeJson, reviewed_outcome_json AS reviewedOutcomeJson FROM resolution_proposals WHERE phase_id = ?').get(openedData.phaseId) as { outcomeJson: string; reviewedOutcomeJson: string };
    expect((JSON.parse(proposal.outcomeJson) as { hunterRequiredIds: string[] }).hunterRequiredIds).toEqual([]);
    expect((JSON.parse(proposal.reviewedOutcomeJson) as { hunterRequiredIds: string[] }).hunterRequiredIds).toEqual([hunterId]);
    const events = sqlite.prepare("SELECT actor_moderator_id AS moderatorId, payload_json AS payloadJson FROM game_events WHERE phase_id = ? AND event_type = 'HUNTER_FOLLOWUP_REQUIRED'").all(openedData.phaseId) as Array<{ moderatorId: string; payloadJson: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].moderatorId).toBe('mod');
    expect(JSON.parse(events[0].payloadJson)).toEqual({ source: 'OVERRIDE', hunterIds: [hunterId], overrideReason: 'Controlled Hunter follow-up test' });
  });

  test.each([true, false])('a finalized Hunter is audited and can be removed by review (submitted: %s)', async (submitted) => {
    const preview = await assignments({ action: 'PREVIEW' });
    const previewData = await preview.json() as { batchId: string; assignments: Array<{ seatId: string; role: string }> };
    expect((await assignments({ action: 'RELEASE', batchId: previewData.batchId })).status).toBe(200);
    const hunterId = previewData.assignments.find((assignment) => assignment.role === 'HUNTER')?.seatId;
    const villagerId = previewData.assignments.find((assignment) => assignment.role === 'VILLAGER')?.seatId;
    expect(hunterId).toBeTruthy();
    expect(villagerId).toBeTruthy();
    if (!hunterId || !villagerId) throw new Error('The fixture must contain a Hunter and a Villager.');
    const opened = await phases({ action: 'OPEN', kind: 'DAY', closesAt: '2099-01-01T00:00Z' });
    const openedData = await opened.json() as { phaseId: string };
    await phases({ action: 'LOCK_AND_PROPOSE', phaseId: openedData.phaseId });
    expect((await phases({ action: 'PUBLISH', phaseId: openedData.phaseId, overrideEliminationIds: [hunterId], overrideReason: 'First Hunter outcome for replacement test' })).status).toBe(200);
    if (submitted) {
      sqlite.prepare("INSERT INTO action_submissions (id,phase_id,actor_seat_id,kind,target_ids_json,version,submitted_at) VALUES (?, ?, ?, 'HUNTER_SHOT', ?, 1, ?)").run('shot', openedData.phaseId, hunterId, JSON.stringify([villagerId]), '2026-01-01');
    } else {
      sqlite.prepare("UPDATE phases SET hunter_deadline_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(openedData.phaseId);
    }
    const finalize = { action: 'FINALIZE_HUNTER', phaseId: openedData.phaseId, skipHunter: !submitted };
    expect((await phases(finalize)).status).toBe(200);
    expect(sqlite.prepare('SELECT status FROM phases WHERE id = ?').get(openedData.phaseId)).toMatchObject({ status: 'PENDING_APPROVAL' });
    const retried = await phases(finalize);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ ok: true, idempotent: true });
    const events = sqlite.prepare("SELECT actor_moderator_id AS moderatorId, payload_json AS payloadJson FROM game_events WHERE phase_id = ? AND event_type = 'HUNTER_RESOLVED'").all(openedData.phaseId) as Array<{ moderatorId: string; payloadJson: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].moderatorId).toBe('mod');
    expect(JSON.parse(events[0].payloadJson)).toEqual({ submitted });
    const replaced = await phases({ action: 'PUBLISH', phaseId: openedData.phaseId, overrideEliminationIds: [villagerId], overrideReason: 'Replace the Hunter outcome after review' });
    expect(replaced.status).toBe(200);
    const outcome = sqlite.prepare('SELECT outcome_json AS outcomeJson, reviewed_outcome_json AS reviewedOutcomeJson, published_outcome_json AS publishedOutcomeJson FROM resolution_proposals WHERE phase_id = ?').get(openedData.phaseId) as { outcomeJson: string; reviewedOutcomeJson: string; publishedOutcomeJson: string };
    expect((JSON.parse(outcome.outcomeJson) as { eliminations: unknown[] }).eliminations).toHaveLength(0);
    expect((JSON.parse(outcome.reviewedOutcomeJson) as { hunterRequiredIds: string[] }).hunterRequiredIds).toEqual([]);
    const published = JSON.parse(outcome.publishedOutcomeJson) as { eliminations: Array<{ playerId: string; cause: string }>; hunterRequiredIds: string[] };
    expect(published.eliminations).toEqual([{ playerId: villagerId, cause: 'DAY_VOTE' }]);
    expect(published.hunterRequiredIds).toEqual([]);
    expect((sqlite.prepare('SELECT alive FROM seats WHERE id = ?').get(hunterId) as { alive: number }).alive).toBe(1);
  });

  test('published outcome remains distinct from the calculated proposal', async () => {
    const preview = await assignments({ action: 'PREVIEW' });
    const previewData = await preview.json() as { batchId: string; assignments: Array<{ seatId: string; role: string }> };
    expect((await assignments({ action: 'RELEASE', batchId: previewData.batchId })).status).toBe(200);
    const villagerId = previewData.assignments.find((assignment) => assignment.role === 'VILLAGER')?.seatId;
    expect(villagerId).toBeTruthy();
    const opened = await phases({ action: 'OPEN', kind: 'DAY', closesAt: '2099-01-01T00:00Z' });
    const openedData = await opened.json() as { phaseId: string };
    await phases({ action: 'LOCK_AND_PROPOSE', phaseId: openedData.phaseId });
    const published = await phases({ action: 'PUBLISH', phaseId: openedData.phaseId, overrideEliminationIds: [villagerId], overrideReason: 'Controlled published outcome test' });
    expect(published.status).toBe(200);
    const loaded = await phaseGet(new Request('http://localhost:3000/api/test'), { params: Promise.resolve({ gameId: 'game' }) });
    const data = await loaded.json() as { phases: Array<{ id: string; proposal: { proposedOutcome: { eliminations: unknown[] }; reviewedOutcome: { eliminations: Array<{ playerId: string }> } | null; publishedOutcome: { eliminations: Array<{ playerId: string }> } | null; reviewedAt: string | null } | null }> };
    const phase = data.phases.find((entry) => entry.id === openedData.phaseId);
    expect(phase?.proposal?.proposedOutcome.eliminations).toHaveLength(0);
    expect(phase?.proposal?.reviewedOutcome?.eliminations.map((entry) => entry.playerId)).toEqual([villagerId]);
    expect(phase?.proposal?.publishedOutcome?.eliminations.map((entry) => entry.playerId)).toEqual([villagerId]);
    expect(phase?.proposal?.reviewedAt).toEqual(expect.any(String));
  });
});
