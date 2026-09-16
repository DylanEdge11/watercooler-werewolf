import { ensureDatabase } from '../../db/migrate';
import { getD1 } from '../../db';
import { hashSecret, randomToken, verifySecret } from './crypto';

export interface CreatedModerator {
  id: string;
  email: string;
  recoveryCodes: string[];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hasModeratorAccount(): Promise<boolean> {
  await ensureDatabase();
  const row = await getD1().prepare('SELECT COUNT(*) AS count FROM moderator_accounts').first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

export async function createPrimaryModerator(email: string, password: string): Promise<CreatedModerator> {
  await ensureDatabase();
  if (await hasModeratorAccount()) throw new Error('The primary moderator already exists.');
  return createModeratorAccount(email, password);
}

export async function createModeratorAccount(email: string, password: string): Promise<CreatedModerator> {
  await ensureDatabase();
  const normalizedEmail = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/u.test(normalizedEmail)) throw new Error('Enter a valid email address.');
  if (password.length < 12) throw new Error('Moderator passwords must be at least 12 characters.');

  const recoveryCodes = Array.from({ length: 8 }, () => randomToken(9));
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map((code) => hashSecret(code)));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getD1()
    .prepare(
      `INSERT INTO moderator_accounts
       (id, email, password_hash, recovery_codes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, normalizedEmail, await hashSecret(password), JSON.stringify(recoveryCodeHashes), now, now)
    .run();
  return { id, email: normalizedEmail, recoveryCodes };
}

export async function authenticateModerator(
  email: string,
  password: string,
): Promise<{ id: string; email: string } | null> {
  await ensureDatabase();
  const row = await getD1()
    .prepare('SELECT id, email, password_hash AS passwordHash FROM moderator_accounts WHERE email = ? LIMIT 1')
    .bind(normalizeEmail(email))
    .first<{ id: string; email: string; passwordHash: string }>();
  if (!row || !(await verifySecret(password, row.passwordHash))) return null;
  return { id: row.id, email: row.email };
}

/**
 * Redeem one stored recovery-code hash and rotate the moderator password.
 * The compare-and-swap on the complete recovery-code JSON makes a code
 * single-use even when two recovery requests arrive at the same time. All
 * existing sessions are invalidated in the same D1 batch as the account
 * update; the caller may then create exactly one fresh session.
 */
export async function redeemModeratorRecoveryCode(
  email: string,
  recoveryCode: string,
  newPassword: string,
): Promise<{ id: string; email: string } | null> {
  await ensureDatabase();
  const normalizedEmail = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/u.test(normalizedEmail) || recoveryCode.trim().length < 8 || newPassword.length < 12) return null;
  const db = getD1();
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
