import initialMigration from '../drizzle/0000_dashing_smiling_tiger.sql?raw';
import bodyguardAndLifecycleMigration from '../drizzle/0001_bodyguard_and_lifecycle.sql?raw';
import pilotHardeningMigration from '../drizzle/0002_pilot_hardening.sql?raw';
import reviewedOutcomeMigration from '../drizzle/0003_reviewed_outcome.sql?raw';
import {
  alteredColumn,
  classifyInitialSchema,
  extractCreatedTableNames,
  makeCreateStatementIdempotent,
  splitMigrationStatements,
} from '../lib/db/migration-state';
import { getD1 } from './index';

const migrations = [
  { version: '0000_dashing_smiling_tiger', sql: initialMigration },
  { version: '0001_bodyguard_and_lifecycle', sql: bodyguardAndLifecycleMigration },
  { version: '0002_pilot_hardening', sql: pilotHardeningMigration },
  { version: '0003_reviewed_outcome', sql: reviewedOutcomeMigration },
] as const;
let initialization: Promise<void> | undefined;

export async function ensureDatabase(): Promise<void> {
  initialization ??= initializeDatabase().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initializeDatabase(): Promise<void> {
  return applyMigrations(getD1());
}

/** Apply the checked-in migration chain to a D1-compatible database. */
export async function applyMigrations(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS __app_migrations (
        version TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      )`,
    )
    .run();

  const appliedRows = await db.prepare('SELECT version FROM __app_migrations').all<{ version: string }>();
  const applied = new Set(appliedRows.results.map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    if (migration.version === migrations[0].version) {
      const expectedTables = extractCreatedTableNames(migration.sql);
      const existingRows = await db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all<{ name: string }>();
      const schemaState = classifyInitialSchema(
        expectedTables,
        existingRows.results.map((row) => row.name),
      );

      if (schemaState.kind === 'PARTIAL') {
        throw new Error(
          `Database has a partial initial schema; refusing an unsafe repair. Missing tables: ${schemaState.missing.join(', ')}.`,
        );
      }

      const initialStatements =
        schemaState.kind === 'EMPTY'
          ? splitMigrationStatements(migration.sql).map(makeCreateStatementIdempotent)
          : [];
      await db.batch([
        ...initialStatements.map((statement) => db.prepare(statement)),
        migrationRecord(db, migration.version),
      ]);
      applied.add(migration.version);
      continue;
    }

    const statements = splitMigrationStatements(migration.sql);
    const columnsByTable = new Map<string, Set<string>>();
    for (const statement of statements) {
      const alteration = alteredColumn(statement);
      if (!alteration || columnsByTable.has(alteration.table)) continue;
      const columnRows = await db
        .prepare(`PRAGMA table_info("${alteration.table}")`)
        .all<{ name: string }>();
      columnsByTable.set(alteration.table, new Set(columnRows.results.map((row) => row.name)));
    }

    const safeStatements = statements
      .filter((statement) => {
        const alteration = alteredColumn(statement);
        return !alteration || !columnsByTable.get(alteration.table)?.has(alteration.column);
      })
      .map(makeCreateStatementIdempotent);
    await db.batch([
      ...safeStatements.map((statement) => db.prepare(statement)),
      migrationRecord(db, migration.version),
    ]);
    applied.add(migration.version);
  }

  await db.prepare('PRAGMA optimize').run();
}

function migrationRecord(db: D1Database, version: string): D1PreparedStatement {
  return db
    .prepare('INSERT OR IGNORE INTO __app_migrations (version, applied_at) VALUES (?, ?)')
    .bind(version, new Date().toISOString());
}
