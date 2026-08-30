import initialMigration from '../drizzle/0000_dashing_smiling_tiger.sql?raw';
import bodyguardAndLifecycleMigration from '../drizzle/0001_bodyguard_and_lifecycle.sql?raw';
import { getD1 } from './index';

const MIGRATIONS = [
  { version: '0000_dashing_smiling_tiger', sql: initialMigration },
  { version: '0001_bodyguard_and_lifecycle', sql: bodyguardAndLifecycleMigration },
];

export async function ensureDatabase(): Promise<void> {
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
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    const statements = migration.sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const appliedAt = new Date().toISOString();
    await db.batch([
      ...statements.map((statement) => db.prepare(statement)),
      db
        .prepare('INSERT OR IGNORE INTO __app_migrations (version, applied_at) VALUES (?, ?)')
        .bind(migration.version, appliedAt),
    ]);
  }
  await db.prepare('PRAGMA optimize').run();
}
