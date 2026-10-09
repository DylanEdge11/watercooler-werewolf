import { getDb } from '../../db';
import { randomToken } from '../auth/crypto';

/**
 * Turns a seat's game email on or off. The first time creates the unsubscribe
 * token that every email carries; it never changes afterward, so an old email's
 * link keeps working.
 */
export async function saveEmailPreference(seatId: string, enabled: boolean): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO email_preferences (seat_id, enabled, unsubscribe_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (seat_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
    .bind(seatId, enabled ? 1 : 0, randomToken(), now, now)
    .run();
}

/**
 * Switches off the seat that owns this unsubscribe token. The token is the only credential,
 * so an unknown one changes nothing and returns false.
 */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const now = new Date().toISOString();
  const db = getDb();
  const known = await db.prepare('SELECT seat_id FROM email_preferences WHERE unsubscribe_token = ?').bind(token).first<{ seat_id: string }>();
  if (!known) return false;
  await db.prepare('UPDATE email_preferences SET enabled = 0, updated_at = ? WHERE unsubscribe_token = ? AND enabled = 1').bind(now, token).run();
  return true;
}
