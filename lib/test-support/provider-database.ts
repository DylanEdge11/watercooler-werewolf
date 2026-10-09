import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

/**
 * A synchronous SQLite file standing in for the production database adapter, for tests that
 * pause a route between two of its reads (see `gate`) to commit a competing write. Tests that
 * do not need that use the real adapter over an in-memory libSQL client instead.
 */
export interface TestStatement {
  readonly sql: string;
  getArgs(): SQLInputValue[];
}

export interface TestDatabase {
  prepare(sql: string): TestStatement;
  batch(statements: TestStatement[]): Promise<unknown>;
}

/** Called after a statement has read its rows, so a test can hold the route there and commit a competing write. */
export type ReadGate = (sql: string, kind: 'first' | 'all') => Promise<void>;

export function providerDatabase(sqlite: DatabaseSync, hooks: { gate?: ReadGate | null } = {}): TestDatabase {
  class ProviderStatement implements TestStatement {
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
      await hooks.gate?.(this.sql, 'first');
      return row ?? null;
    }

    async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
      const results = sqlite.prepare(this.sql).all(...this.args) as T[];
      await hooks.gate?.(this.sql, 'all');
      return { results };
    }

    async run(): Promise<{ meta: { changes: number } }> {
      const result = sqlite.prepare(this.sql).run(...this.args);
      return { meta: { changes: Number(result.changes) } };
    }
  }

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
