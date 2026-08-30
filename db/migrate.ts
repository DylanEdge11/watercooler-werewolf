import initialMigration from '../drizzle/0000_dashing_smiling_tiger.sql?raw';
import bodyguardAndLifecycleMigration from '../drizzle/0001_bodyguard_and_lifecycle.sql?raw';
import {
  alteredColumn,
  classifyInitialSchema,
  extractCreatedTableNames,
  makeCreateStatementIdempotent,
  splitMigrationStatements,
} from '../lib/db/migration-state';
import { getD1 } from './index';

const INITIAL_VERSION = '0000_dashing_smiling_tiger';
const LIFECYCLE_VERSION = '0001_bodyguard_and_lifecycle';
let initialization: Promise<void> | undefined;

export async function ensureDatabase(): Promise<void> {
  initialization ??= initializeDatabase().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initializeDatabase(): Promise<void> {
  const db = getD1();
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

  if (!applied.has(INITIAL_VERSION)) {
    const expectedTables = extractCreatedTableNames(initialMigration);
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
        ? splitMigrationStatements(initialMigration).map(makeCreateStatementIdempotent)
        : [];
    await db.batch([
      ...initialStatements.map((statement) => db.prepare(statement)),
      migrationRecord(db, INITIAL_VERSION),
    ]);
  }

  if (!applied.has(LIFECYCLE_VERSION)) {
    const statements = splitMigrationStatements(bodyguardAndLifecycleMigration);
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
      migrationRecord(db, LIFECYCLE_VERSION),
    ]);
  }

  await db.prepare('PRAGMA optimize').run();
}

function migrationRecord(db: D1Database, version: string): D1PreparedStatement {
  return db
    .prepare('INSERT OR IGNORE INTO __app_migrations (version, applied_at) VALUES (?, ?)')
    .bind(version, new Date().toISOString());
}
