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
