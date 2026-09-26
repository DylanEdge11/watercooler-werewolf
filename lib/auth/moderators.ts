import { ensureDatabase } from '../../db/migrate';
import { getDb } from '../../db';
import type { Database } from '../../db/contracts';
import { hashSecret, verifySecret } from './crypto';
import { bootstrapPrimaryModerator, hasModeratorAccountInDatabase as hasModeratorAccountInDatabaseCore, INSERT_MODERATOR_SQL, normalizeModeratorEmail, prepareModeratorAccount, type CreatedModerator } from './bootstrap';
import { isSingleEmailAddress } from '../roster/email-address';

export async function hasModeratorAccount(): Promise<boolean> {
  await ensureDatabase();
  return hasModeratorAccountInDatabaseCore(getDb());
}

export async function hasModeratorAccountInDatabase(db: Database): Promise<boolean> {
  return hasModeratorAccountInDatabaseCore(db);
}

export async function createPrimaryModerator(email: string, password: string): Promise<CreatedModerator> {
  await ensureDatabase();
  return bootstrapPrimaryModerator(getDb(), email, password);
}

export async function createModeratorAccount(email: string, password: string): Promise<CreatedModerator> {
  await ensureDatabase();
  return createModeratorAccountInDatabase(getDb(), email, password);
}

/** Create a co-moderator account without changing the primary bootstrap marker. */
export async function createModeratorAccountInDatabase(db: Database, email: string, password: string): Promise<CreatedModerator> {
  const prepared = await prepareModeratorAccount(email, password);
  await db.prepare(INSERT_MODERATOR_SQL).bind(...prepared.values).run();
  return prepared.account;
}

export async function authenticateModerator(
  email: string,
  password: string,
): Promise<{ id: string; email: string } | null> {
  await ensureDatabase();
  const row = await getDb()
    .prepare('SELECT id, email, password_hash AS passwordHash FROM moderator_accounts WHERE email = ? LIMIT 1')
    .bind(normalizeModeratorEmail(email))
    .first<{ id: string; email: string; passwordHash: string }>();
  if (!row || !(await verifySecret(password, row.passwordHash))) return null;
  return { id: row.id, email: row.email };
}

/**
 * Redeem one stored recovery-code hash and rotate the moderator password.
 * The compare-and-swap on the complete recovery-code JSON makes a code
 * single-use even when two recovery requests arrive at the same time. All
 * existing sessions are invalidated in the same provider batch as the account
 * update; the caller may then create exactly one fresh session.
 */
export async function redeemModeratorRecoveryCode(
  email: string,
  recoveryCode: string,
  newPassword: string,
): Promise<{ id: string; email: string } | null> {
  await ensureDatabase();
  const normalizedEmail = normalizeModeratorEmail(email);
  if (!isSingleEmailAddress(normalizedEmail) || recoveryCode.trim().length < 8 || newPassword.length < 12) return null;
  const db = getDb();
  const account = await db
    .prepare('SELECT id, email, recovery_codes_json AS recoveryCodesJson FROM moderator_accounts WHERE email = ? LIMIT 1')
    .bind(normalizedEmail)
    .first<{ id: string; email: string; recoveryCodesJson: string }>();
  if (!account) return null;

  let hashes: string[];
  try {
    const parsed = JSON.parse(account.recoveryCodesJson) as unknown;
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) return null;
    hashes = parsed;
  } catch {
    return null;
  }
  let matchedIndex = -1;
  for (let index = 0; index < hashes.length; index += 1) {
    if (await verifySecret(recoveryCode.trim(), hashes[index])) {
      matchedIndex = index;
      break;
    }
  }
  if (matchedIndex < 0) return null;

  const remaining = hashes.filter((_hash, index) => index !== matchedIndex);
  const now = new Date().toISOString();
  const updated = await db.batch([
    db
      .prepare(
        `UPDATE moderator_accounts
         SET password_hash = ?, recovery_codes_json = ?, updated_at = ?
         WHERE id = ? AND email = ? AND recovery_codes_json = ?`,
      )
      .bind(await hashSecret(newPassword), JSON.stringify(remaining), now, account.id, normalizedEmail, account.recoveryCodesJson),
    db
      .prepare(
        `DELETE FROM moderator_sessions
         WHERE moderator_id = ?
           AND EXISTS (SELECT 1 FROM moderator_accounts WHERE id = ? AND updated_at = ? AND recovery_codes_json = ?)`,
      )
      .bind(account.id, account.id, now, JSON.stringify(remaining)),
  ]);
  if (Number((updated[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0) !== 1) return null;
  return { id: account.id, email: account.email };
}
