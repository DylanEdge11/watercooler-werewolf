import type { Database } from '../../db/contracts';
import { hashSecret, randomToken } from './crypto';

export interface CreatedModerator {
  id: string;
  email: string;
  recoveryCodes: string[];
}

export function normalizeModeratorEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hasModeratorAccountInDatabase(db: Database): Promise<boolean> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM moderator_accounts').first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

/**
 * One-time operator bootstrap. The marker and account are inserted in the
 * same ordered write transaction, so concurrent operators cannot create two
 * initial owners and a failed account insert cannot leave a claimed marker.
 */
export async function bootstrapPrimaryModerator(db: Database, email: string, password: string): Promise<CreatedModerator> {
  if (await hasModeratorAccountInDatabase(db)) throw new Error('The primary moderator already exists.');
  const normalizedEmail = normalizeModeratorEmail(email);
  if (!/^\S+@\S+\.\S+$/u.test(normalizedEmail)) throw new Error('Enter a valid email address.');
  if (password.length < 12) throw new Error('Moderator passwords must be at least 12 characters.');

  const recoveryCodes = Array.from({ length: 8 }, () => randomToken(9));
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map((code) => hashSecret(code)));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    const results = await db.batch([
      db.prepare('INSERT INTO app_bootstrap (id, created_at) VALUES (1, ?)').bind(now),
      db
        .prepare(
          `INSERT INTO moderator_accounts
           (id, email, password_hash, recovery_codes_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, normalizedEmail, await hashSecret(password), JSON.stringify(recoveryCodeHashes), now, now),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1 || Number(results[1]?.meta?.changes ?? 0) !== 1) {
      throw new Error('The primary moderator bootstrap did not complete.');
    }
  } catch (error) {
    // Avoid leaking provider-specific constraint details through the operator
    // command or public API while retaining unexpected errors for diagnostics.
    if (error instanceof Error && /constraint|unique|primary key/iu.test(error.message)) {
      throw new Error('The primary moderator already exists.');
    }
    throw error;
  }
  return { id, email: normalizedEmail, recoveryCodes };
}
