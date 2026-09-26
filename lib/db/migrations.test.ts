import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../../db/libsql';
import { MIGRATION_VERSIONS, verifyDatabaseReady } from '../../db/readiness';
import { readFileSync } from 'node:fs';
import { loadMigrations, MIGRATION_FILES, runMigrations, splitMigrationStatements } from '../../scripts/db-migration-runner.mjs';

let client: Client;

function database(): LibsqlDatabase {
  return new LibsqlDatabase(client as unknown as LibsqlClient);
}

beforeEach(() => {
  client = createClient({ url: ':memory:' });
});

afterEach(() => client.close());

describe('libSQL migration chain', () => {
  test('the runner, the readiness check, and the Drizzle journal list the same migrations in order', () => {
    const journal = JSON.parse(readFileSync(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: Array<{ tag: string }> };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(MIGRATION_FILES.map((file: string) => file.replace(/\.sql$/u, ''))).toEqual(tags);
    expect([...MIGRATION_VERSIONS]).toEqual(tags);
  });

  test('fresh install applies all migrations and is safe to rerun', async () => {
    const migrations = await loadMigrations();
    await runMigrations(client, migrations);
    await runMigrations(client, migrations);
    await verifyDatabaseReady(database());

    const versions = await client.execute('SELECT version FROM __app_migrations ORDER BY version');
    expect(versions.rows.map((row) => row.version)).toEqual([...MIGRATION_VERSIONS]);
    const tables = await client.execute("SELECT name FROM sqlite_schema WHERE type = 'table'");
    expect(tables.rows.map((row) => row.name)).toContain('rate_limit_buckets');
    expect(tables.rows.map((row) => row.name)).toContain('app_bootstrap');

    const gamesColumns = await client.execute('PRAGMA table_info(games)');
    expect(gamesColumns.rows.map((row) => row.name)).toContain('setup_revision');
    const assignmentColumns = await client.execute('PRAGMA table_info(assignment_batches)');
    expect(assignmentColumns.rows.map((row) => row.name)).toContain('roster_fingerprint');
    const proposalColumns = await client.execute('PRAGMA table_info(resolution_proposals)');
    expect(proposalColumns.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['published_outcome_json', 'reviewed_outcome_json']),
    );
    const foreignKeys = await client.execute('PRAGMA foreign_keys');
    expect(Number(foreignKeys.rows[0]?.foreign_keys)).toBe(1);
  });

  test('adopts a complete initial schema and applies only the missing migrations', async () => {
    const migrations = await loadMigrations();
    await client.batch(
      splitMigrationStatements(migrations[0].sql).map((sql: string) => ({ sql, args: [] })),
      'write',
    );
    await runMigrations(client, migrations);

    const versions = await client.execute('SELECT COUNT(*) AS count FROM __app_migrations');
    expect(Number(versions.rows[0]?.count)).toBe(MIGRATION_VERSIONS.length);
    const gamesColumns = await client.execute('PRAGMA table_info(games)');
    expect(gamesColumns.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['stopped_at', 'reset_at', 'setup_revision']),
    );
  });

  test('provider batches roll back every ordered write when one statement fails', async () => {
    await client.execute('CREATE TABLE batch_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)');

    await expect(
      client.batch(
        [
          { sql: 'INSERT INTO batch_probe (id, value) VALUES (?, ?)', args: [1, 'first'] },
          { sql: 'INSERT INTO batch_probe (id, value) VALUES (?, ?)', args: [2, 'first'] },
        ],
        'write',
      ),
    ).rejects.toThrow();

    const rows = await client.execute('SELECT COUNT(*) AS count FROM batch_probe');
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });

});
