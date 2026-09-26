import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

interface TestProviderStatement {
  readonly sql: string;
  getArgs(): SQLInputValue[];
}

interface TestProviderDatabase {
  prepare(sql: string): TestProviderStatement;
  batch(statements: TestProviderStatement[]): Promise<unknown>;
}

const shared = vi.hoisted(() => ({
  db: null as TestProviderDatabase | null,
  gate: null as null | ((sql: string, kind: 'first' | 'all') => Promise<void>),
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/auth/session', () => ({ getCurrentPlayer: async () => ({ seatId: 'p0', gameId: 'game', alive: true }) }));

import { POST as phasePost } from '../app/api/games/[gameId]/phases/route';
import { POST as actionPost } from '../app/api/phases/[phaseId]/actions/route';

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
    await shared.gate?.(this.sql, 'first');
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const results = sqlite.prepare(this.sql).all(...this.args) as T[];
    await shared.gate?.(this.sql, 'all');
    return { results };
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

function phase(body: Record<string, unknown>): Promise<Response> {
  return phasePost(request(body), { params: Promise.resolve({ gameId: 'game' }) });
}

function action(body: Record<string, unknown>): Promise<Response> {
  return actionPost(request(body), { params: Promise.resolve({ phaseId: 'phase' }) });
}

function gateOn(pattern: string, kind: 'first' | 'all') {
  let release!: () => void;
  let entered!: () => void;
  let calls = 0;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  shared.gate = async (sql, observedKind) => {
    if (!sql.includes(pattern) || observedKind !== kind) return;
    calls += 1;
    if (calls === 1) entered();
    if (calls === 2) {
      shared.gate = null;
      release();
    }
    await blocked;
  };
  return { reached, release };
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of ['0000_dashing_smiling_tiger.sql', '0001_bodyguard_and_lifecycle.sql', '0002_pilot_hardening.sql', '0003_reviewed_outcome.sql']) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  }
  shared.gate = null;
  shared.db = {
    prepare: (sql: string) => new ProviderStatement(sql),
    batch: async (statements: ProviderStatement[]) => {
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
  sqlite.exec("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','review@pilot.test','fake','[]','2026-01-01','2026-01-01'); INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Review','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01'); INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01'); INSERT INTO assignment_batches (id,game_id,revision,setup_revision,roster_fingerprint,composition_fingerprint,assignments_json,random_evidence_hash,created_by_moderator_id,created_at) VALUES ('batch','game',1,1,'roster','composition','[]','hash','mod','2026-01-01');");
  for (let index = 0; index < 20; index += 1) {
    sqlite.prepare("INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,created_at,updated_at) VALUES (?,'game',?,?,'CLAIMED',?,'2026-01-01','2026-01-01')").run('p' + index, 'Player ' + index, 'p' + index + '@pilot.test', 'hash' + index);
    sqlite.prepare("INSERT INTO role_assignments (game_id,seat_id,role_key,assignment_batch_id) VALUES ('game',?,?, 'batch')").run('p' + index, index > 16 ? 'WEREWOLF' : 'VILLAGER');
  }
  sqlite.exec("INSERT INTO phases (id,game_id,sequence,kind,status,opens_at,closes_at,slots,divisor_snapshot,created_at,updated_at) VALUES ('phase','game',1,'DAY','OPEN','2026-01-01','2099-01-01',1,30,'2026-01-01','2026-01-01');");
});

afterEach(() => sqlite.close());

describe('provider race invariants', () => {
  test('a submission committed before lock is included in the proposal input', async () => {
    const saved = await action({ actionKind: 'DAY_VOTE', targetIds: ['p1'] });
    expect(saved.status).toBe(200);
    const locked = await phase({ action: 'LOCK_AND_PROPOSE', phaseId: 'phase' });
    expect(locked.status).toBe(200);
    const proposal = sqlite.prepare('SELECT outcome_json AS outcomeJson FROM resolution_proposals WHERE phase_id = ?').get('phase') as { outcomeJson: string };
    expect(JSON.parse(proposal.outcomeJson).tally).toEqual([{ playerId: 'p1', votes: 1 }]);
  });

  test('each saved revision records its audit event with the same version, in one transaction', async () => {
    const first = await (await action({ actionKind: 'DAY_VOTE', targetIds: ['p1'] })).json() as { version: number };
    const second = await (await action({ actionKind: 'DAY_VOTE', targetIds: ['p2'] })).json() as { version: number };
    expect([first.version, second.version]).toEqual([1, 2]);
    const events = sqlite.prepare("SELECT payload_json AS payload FROM game_events WHERE event_type = 'ACTION_SUBMITTED' ORDER BY created_at, payload_json").all() as Array<{ payload: string }>;
    expect(events.map((event) => JSON.parse(event.payload))).toEqual([{ kind: 'DAY_VOTE', version: 1 }, { kind: 'DAY_VOTE', version: 2 }]);
  });

  test('a submission validated before lock cannot commit after the lock', async () => {
    const gate = gateOn('p.hunter_deadline_at AS hunterDeadlineAt', 'first');
    const pending = action({ actionKind: 'DAY_VOTE', targetIds: ['p1'] });
    await gate.reached;
    const locked = await phase({ action: 'LOCK_AND_PROPOSE', phaseId: 'phase' });
    expect(locked.status).toBe(200);
    gate.release();
    const result = await pending;
    expect(result.status).toBe(409);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM action_submissions').get() as { count: number }).count).toBe(0);
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'ACTION_SUBMITTED'").get() as { count: number }).count).toBe(0);
  });

  test('a scheduler-locked phase can still be proposed without reopening it', async () => {
    sqlite.exec("UPDATE phases SET status = 'LOCKED', closes_at = '2026-01-01T00:00:00.000Z'");
    const result = await phase({ action: 'LOCK_AND_PROPOSE', phaseId: 'phase' });
    expect(result.status).toBe(200);
    expect((sqlite.prepare('SELECT status FROM phases WHERE id = ?').get('phase') as { status: string }).status).toBe('PENDING_APPROVAL');
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM resolution_proposals WHERE phase_id = ?').get('phase') as { count: number }).count).toBe(1);
  });

  test('competing publications commit one authoritative elimination set', async () => {
    await phase({ action: 'LOCK_AND_PROPOSE', phaseId: 'phase' });
    gateOn('ORDER BY s.id', 'all');
    const responses = await Promise.all([
      phase({ action: 'PUBLISH', phaseId: 'phase', overrideReason: 'First moderator correction', overrideEliminationIds: ['p1'] }),
      phase({ action: 'PUBLISH', phaseId: 'phase', overrideReason: 'Second moderator correction', overrideEliminationIds: ['p2'] }),
    ]);
    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true);
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM seats WHERE alive = 0').get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM game_events WHERE event_type = 'PHASE_PUBLISHED'").get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare('SELECT status FROM phases WHERE id = ?').get('phase') as { status: string }).status).toBe('PUBLISHED');
  });

  test('publication cannot revive a phase superseded by Stop', async () => {
    await phase({ action: 'LOCK_AND_PROPOSE', phaseId: 'phase' });
    const gate = gateOn('ORDER BY s.id', 'all');
    const pending = phase({ action: 'PUBLISH', phaseId: 'phase', overrideReason: 'Review controlled interleaving', overrideEliminationIds: ['p1'] });
    await gate.reached;
    sqlite.exec("UPDATE games SET status = 'STOPPED'; UPDATE phases SET status = 'SUPERSEDED';");
    gate.release();
    expect((await pending).status).toBe(409);
    expect((sqlite.prepare('SELECT status FROM phases WHERE id = ?').get('phase') as { status: string }).status).toBe('SUPERSEDED');
  });
});
