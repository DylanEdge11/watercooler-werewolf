import { createClient } from '@libsql/client';
import { loadLocalEnv } from './load-env.mjs';
import { loadMigrations, runMigrations } from './db-migration-runner.mjs';
import { confirmDatabaseTarget, envSource } from './lib/target-database.mjs';

const { sources } = loadLocalEnv();

const url = process.env.TURSO_DATABASE_URL?.trim();
if (!url) throw new Error('Set TURSO_DATABASE_URL before running database migrations.');
if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
  throw new Error('Run migrations from a trusted operator environment, not from a deployed function.');
}

await confirmDatabaseTarget({ url, source: envSource(sources, 'TURSO_DATABASE_URL') });

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
});

try {
  const migrations = await loadMigrations();
  const before = await client.execute('SELECT COUNT(*) AS n FROM __app_migrations').then((result) => Number(result.rows[0].n), () => 0);
  const applied = await runMigrations(client, migrations);
  const added = applied.length - before;
  console.log(`Database is current: ${added} new migration${added === 1 ? '' : 's'} applied, ${applied.length} recorded in total.`);
} finally {
  client.close();
}
