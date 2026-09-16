import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

vi.mock('../../db', () => ({ getD1: () => { throw new Error('getD1 is not used by this test'); } }));

import { applyMigrations } from '../../db/migrate';

let sqlite: DatabaseSync;

class TestStatement {
  private args: SQLInputValue[] = [];

  constructor(readonly sql: string) {}

  bind(...args: SQLInputValue[]): this {
    this.args = args;
    return this;
  }

  getArgs(): SQLInputValue[] {
    return this.args;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = sqlite.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes) } };
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: sqlite.prepare(this.sql).all(...this.args) as T[] };
  }
}

function d1Compatible() {
  return {
    prepare: (sql: string) => new TestStatement(sql),
    batch: async (statements: TestStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const result = sqlite.prepare(statement.sql).run(...statement.getArgs());
          results.push({ meta: { changes: Number(result.changes) } });
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

function applyInitialSchema() {
  sqlite.exec(readFileSync(new URL('../../drizzle/0000_dashing_smiling_tiger.sql', import.meta.url), 'utf8'));
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
});

afterEach(() => sqlite.close());

describe('migration chain', () => {
  test('fresh install applies all migrations and is safe to rerun', async () => {
    const db = d1Compatible();
    await applyMigrations(db);
    await applyMigrations(db);
    const versions = sqlite.prepare('SELECT version FROM __app_migrations ORDER BY version').all() as Array<{ version: string }>;
    expect(versions.map((row) => row.version)).toEqual([
      '0000_dashing_smiling_tiger',
      '0001_bodyguard_and_lifecycle',
      '0002_pilot_hardening',
      '0003_reviewed_outcome',
    ]);
    expect(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'rate_limit_buckets'").get()).toBeTruthy();
    expect((sqlite.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>).map((row) => row.name)).toContain('setup_revision');
    expect((sqlite.prepare('PRAGMA table_info(assignment_batches)').all() as Array<{ name: string }>).map((row) => row.name)).toContain('roster_fingerprint');
    expect((sqlite.prepare('PRAGMA table_info(resolution_proposals)').all() as Array<{ name: string }>).map((row) => row.name)).toContain('published_outcome_json');
    expect((sqlite.prepare('PRAGMA table_info(resolution_proposals)').all() as Array<{ name: string }>).map((row) => row.name)).toContain('reviewed_outcome_json');
  });

  test('an existing initial schema receives only the missing additive migrations', async () => {
    applyInitialSchema();
    const db = d1Compatible();
    await applyMigrations(db);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __app_migrations').get() as { count: number }).toMatchObject({ count: 4 });
    expect((sqlite.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>).map((row) => row.name)).toEqual(expect.arrayContaining(['stopped_at', 'reset_at', 'setup_revision']));
    expect(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'pilot_feedback'").get()).toBeTruthy();
  });
});
