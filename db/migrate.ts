import initialMigration from '../drizzle/0000_dashing_smiling_tiger.sql?raw';
import { getD1 } from './index';

const MIGRATION_VERSION = '0000_dashing_smiling_tiger';

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

  const applied = await db
    .prepare('SELECT version FROM __app_migrations WHERE version = ? LIMIT 1')
    .bind(MIGRATION_VERSION)
    .first<{ version: string }>();
  if (applied) return;

  const statements = initialMigration
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.prepare(statement).run();
  }

  await db
    .prepare('INSERT OR IGNORE INTO __app_migrations (version, applied_at) VALUES (?, ?)')
    .bind(MIGRATION_VERSION, new Date().toISOString())
    .run();
  await db.prepare('PRAGMA optimize').run();
}

