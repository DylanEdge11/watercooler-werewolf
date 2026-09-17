import type { Database } from './contracts';

export const MIGRATION_VERSIONS = [
  '0000_dashing_smiling_tiger',
  '0001_bodyguard_and_lifecycle',
  '0002_pilot_hardening',
  '0003_reviewed_outcome',
  '0004_operator_bootstrap',
] as const;

export async function verifyDatabaseReady(db: Database): Promise<void> {
  let appliedRows: { version: string }[];
  try {
    appliedRows = (await db.prepare('SELECT version FROM __app_migrations').all<{ version: string }>()).results;
  } catch {
    throw new Error('Database schema is not initialized. Run `npm run db:migrate` with the target database configured.');
  }

  const applied = new Set(appliedRows.map((row) => row.version));
  const missing = MIGRATION_VERSIONS.filter((version) => !applied.has(version));
  if (missing.length) {
    throw new Error(`Database schema is not current. Run \`npm run db:migrate\`; missing: ${missing.join(', ')}.`);
  }
}
