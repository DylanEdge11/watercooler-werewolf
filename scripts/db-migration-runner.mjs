import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MIGRATION_FILES = [
  '0000_dashing_smiling_tiger.sql',
  '0001_bodyguard_and_lifecycle.sql',
  '0002_pilot_hardening.sql',
  '0003_reviewed_outcome.sql',
  '0004_operator_bootstrap.sql',
  '0005_game_automation.sql',
  '0006_game_events_type_index.sql',
  '0007_email_notifications.sql',
];

export function splitMigrationStatements(sql) {
  return sql.split('--> statement-breakpoint').map((statement) => statement.trim()).filter(Boolean);
}

export function extractCreatedTableNames(sql) {
  return splitMigrationStatements(sql)
    .map((statement) => statement.match(/^CREATE TABLE(?: IF NOT EXISTS)?\s+[`"]?([\w]+)[`"]?/iu)?.[1])
    .filter(Boolean);
}

export function makeCreateStatementIdempotent(statement) {
  return statement
    .replace(/^CREATE TABLE\s+(?!IF NOT EXISTS)/iu, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE UNIQUE INDEX\s+(?!IF NOT EXISTS)/iu, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/^CREATE INDEX\s+(?!IF NOT EXISTS)/iu, 'CREATE INDEX IF NOT EXISTS ');
}

function alteredColumn(statement) {
  const match = statement.match(/^ALTER TABLE\s+[`"]?([\w]+)[`"]?\s+ADD(?: COLUMN)?\s+[`"]?([\w]+)[`"]?/iu);
  return match ? { table: match[1], column: match[2] } : null;
}

export async function loadMigrations(directory = resolve('drizzle')) {
  return Promise.all(MIGRATION_FILES.map(async (file) => ({
    version: file.replace(/\.sql$/u, ''),
    sql: await readFile(resolve(directory, file), 'utf8'),
  })));
}

/**
 * Apply migrations with libSQL's ordered, implicit write transaction. Every
 * migration record is committed in the same transaction as that migration.
 */
export async function runMigrations(client, migrations) {
  await client.execute(`CREATE TABLE IF NOT EXISTS __app_migrations (
    version TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  await client.execute('PRAGMA foreign_keys = ON');

  const appliedRows = await client.execute('SELECT version FROM __app_migrations');
  const applied = new Set(appliedRows.rows.map((row) => String(row.version)));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    if (migration.version === migrations[0].version) {
      const expectedTables = extractCreatedTableNames(migration.sql);
      const existingRows = await client.execute("SELECT name FROM sqlite_schema WHERE type = 'table'");
      const existing = new Set(existingRows.rows.map((row) => String(row.name)).filter((name) => name !== '__app_migrations'));
      const present = expectedTables.filter((table) => existing.has(table));
      const missing = expectedTables.filter((table) => !existing.has(table));
      if (present.length && missing.length) {
        throw new Error(`Database has a partial initial schema; refusing an unsafe repair. Missing tables: ${missing.join(', ')}.`);
      }
      const initialStatements = present.length === 0
        ? splitMigrationStatements(migration.sql).map(makeCreateStatementIdempotent)
        : [];
      await client.batch([
        ...initialStatements.map((sql) => ({ sql, args: [] })),
        { sql: 'INSERT OR IGNORE INTO __app_migrations (version, applied_at) VALUES (?, ?)', args: [migration.version, new Date().toISOString()] },
      ], 'write');
      applied.add(migration.version);
      continue;
    }

    const statements = splitMigrationStatements(migration.sql);
    const columnsByTable = new Map();
    for (const statement of statements) {
      const alteration = alteredColumn(statement);
      if (!alteration || columnsByTable.has(alteration.table)) continue;
      const columnRows = await client.execute(`PRAGMA table_info("${alteration.table}")`);
      columnsByTable.set(alteration.table, new Set(columnRows.rows.map((row) => String(row.name))));
    }
    const safeStatements = statements
      .filter((statement) => {
        const alteration = alteredColumn(statement);
        return !alteration || !columnsByTable.get(alteration.table)?.has(alteration.column);
      })
      .map(makeCreateStatementIdempotent);
    await client.batch([
      ...safeStatements.map((sql) => ({ sql, args: [] })),
      { sql: 'INSERT OR IGNORE INTO __app_migrations (version, applied_at) VALUES (?, ?)', args: [migration.version, new Date().toISOString()] },
    ], 'write');
    applied.add(migration.version);
  }

  return [...applied];
}
