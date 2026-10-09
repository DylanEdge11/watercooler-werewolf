import { getDb } from './index';
import { verifyDatabaseReady } from './readiness';

let readiness: Promise<void> | undefined;

/**
 * Requests never mutate schema. They only verify that the operator-run
 * migration command has completed every checked-in migration.
 */
export async function ensureDatabase(): Promise<void> {
  readiness ??= verifyDatabaseReady(getDb()).catch((error) => {
    readiness = undefined;
    throw error;
  });
  return readiness;
}
