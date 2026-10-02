import { getDb, type Database } from '../../db';
import { changes } from '../../db/results';
import { sha256 } from './crypto';
import { clearPinFailures } from './pin-lockout';
import { prepareSpectatorSession } from './session';

export interface SpectatorLink {
  displayName: string;
  status: 'INVITED' | 'ACTIVE';
  gameName: string;
}

/** The spectator and game a spectator link points to, or null for an unknown or removed spectator. */
export async function lookupSpectatorLink(code: string): Promise<SpectatorLink | null> {
  return getDb()
    .prepare(
      `SELECT sp.display_name AS displayName, sp.status, g.name AS gameName
       FROM spectators sp JOIN games g ON g.id = sp.game_id
       WHERE sp.claim_code_hash = ? AND sp.status != 'REMOVED' LIMIT 1`,
    )
    .bind(await sha256(code))
    .first<SpectatorLink>();
}

export const INVALID_SPECTATOR_LINK = 'This spectator link is not valid. Ask your moderator for a new one.';

export const SPECTATOR_LOCKED_MESSAGE = 'This spectator link is locked after too many wrong PINs. Ask your moderator to remove you and add you again for a new link.';

/** Wrong-PIN counters share rate_limit_buckets with seats; this prefix keeps the two apart. */
export function spectatorLockoutId(spectatorId: string): string {
  return `spectator:${spectatorId}`;
}

/**
 * Signs a returning spectator in from the home page, after their PIN was
 * checked: a session for this device and a fresh wrong-PIN count, written
 * together only while the spectator is still active at the version that was
 * read. False means they were removed in the meantime, and no cookie is set.
 */
export async function startSpectatorSession(db: Database, spectator: { id: string; sessionVersion: number }): Promise<boolean> {
  const session = await prepareSpectatorSession(spectator.id, spectator.sessionVersion);
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO spectator_sessions (id, spectator_id, token_hash, session_version, expires_at, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM spectators WHERE id = ? AND status = 'ACTIVE' AND session_version = ?)`,
      )
      .bind(...session.values, spectator.id, spectator.sessionVersion),
    clearPinFailures(db, spectatorLockoutId(spectator.id)),
  ]);
  if (changes(result[0]) !== 1) return false;
  await session.setCookie();
  return true;
}
