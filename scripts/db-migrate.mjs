import { createClient } from '@libsql/client';
import { loadLocalEnv } from './load-env.mjs';
import { loadMigrations, runMigrations } from './db-migration-runner.mjs';

loadLocalEnv();

const url = process.env.TURSO_DATABASE_URL?.trim();
if (!url) throw new Error('Set TURSO_DATABASE_URL before running database migrations.');
if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
  throw new Error('Run migrations from a trusted operator environment, not from a deployed function.');
}

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
});

try {
  const migrations = await loadMigrations();
  const applied = await runMigrations(client, migrations);
  console.log(`Database is current (${applied.length} migrations applied).`);
} finally {
  client.close();
}
