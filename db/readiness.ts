import { HttpError } from '../lib/http/errors';
import type { Database } from './contracts';

export const MIGRATION_VERSIONS = [
  '0000_dashing_smiling_tiger',
  '0001_bodyguard_and_lifecycle',
  '0002_pilot_hardening',
  '0003_reviewed_outcome',
  '0004_operator_bootstrap',
  '0005_game_automation',
  '0006_game_events_type_index',
  '0007_email_notifications',
  '0008_spectators',
  '0009_elimination_schedule',
] as const;

export async function verifyDatabaseReady(db: Database): Promise<void> {
  let appliedRows: { version: string }[];
  try {
    appliedRows = (await db.prepare('SELECT version FROM __app_migrations').all<{ version: string }>()).results;
  } catch {
    throw new HttpError(503, 'Database schema is not initialized. Run `npm run db:migrate` with the target database configured.');
  }

  const applied = new Set(appliedRows.map((row) => row.version));
  const missing = MIGRATION_VERSIONS.filter((version) => !applied.has(version));
  if (missing.length) {
    throw new HttpError(503, `Database schema is not current. Run \`npm run db:migrate\`; missing: ${missing.join(', ')}.`);
  }
}
