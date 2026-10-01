import { getDb } from '../../db';
import { sha256 } from './crypto';

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
