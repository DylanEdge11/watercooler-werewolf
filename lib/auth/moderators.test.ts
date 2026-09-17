import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

interface TestStatement {
  readonly sql: string;
  getArgs(): SQLInputValue[];
}

interface TestDatabase {
  prepare(sql: string): TestStatement;
  batch(statements: TestStatement[]): Promise<unknown>;
}

const shared = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock('../../db', () => ({ getDb: () => shared.db }));
vi.mock('../../db/migrate', () => ({ ensureDatabase: async () => {} }));

import { authenticateModerator, createModeratorAccount, redeemModeratorRecoveryCode } from './moderators';

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

function d1Compatible(): TestDatabase {
  return {
    prepare: (sql) => new ProviderStatement(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results: Array<{ meta: { changes: number } }> = [];
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
  };
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../drizzle/0000_dashing_smiling_tiger.sql', import.meta.url), 'utf8'));
  shared.db = d1Compatible();
});

afterEach(() => sqlite.close());

describe('moderator credential recovery', () => {
  test('redeems a recovery code once, rotates the password, and invalidates sessions', async () => {
    const created = await createModeratorAccount('Moderator@pilot.test', 'old-fictional-password');
    sqlite.prepare('INSERT INTO moderator_sessions (id,moderator_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)').run('session-1', created.id, 'token-hash', '2099-01-01', '2026-01-01');

    await expect(redeemModeratorRecoveryCode('moderator@pilot.test', created.recoveryCodes[0], 'new-fictional-password')).resolves.toMatchObject({ id: created.id, email: 'moderator@pilot.test' });
    await expect(authenticateModerator('moderator@pilot.test', 'old-fictional-password')).resolves.toBeNull();
    await expect(authenticateModerator('moderator@pilot.test', 'new-fictional-password')).resolves.toMatchObject({ id: created.id });
    expect((sqlite.prepare('SELECT COUNT(*) AS count FROM moderator_sessions').get() as { count: number }).count).toBe(0);
    expect(JSON.parse((sqlite.prepare('SELECT recovery_codes_json AS codes FROM moderator_accounts WHERE id = ?').get(created.id) as { codes: string }).codes)).toHaveLength(7);
    await expect(redeemModeratorRecoveryCode('moderator@pilot.test', created.recoveryCodes[0], 'another-fictional-password')).resolves.toBeNull();
  });
});
