import { getDb } from '../../db';
import { sha256 } from './crypto';

export interface ClaimSeat {
  displayName: string;
  status: string;
  gameName: string;
}

/** The seat and game an invitation code points to, or null when the code matches no seat. */
export async function lookupClaimSeat(code: string): Promise<ClaimSeat | null> {
  return getDb()
    .prepare(
      `SELECT s.display_name AS displayName, s.status, g.name AS gameName
       FROM seats s JOIN games g ON g.id = s.game_id
       WHERE s.claim_code_hash = ? LIMIT 1`,
    )
    .bind(await sha256(code))
    .first<ClaimSeat>();
}

export const INVALID_CLAIM_LINK = 'This private seat link is not valid.';

/** An old invitation to a game that has ended can no longer be used to claim its seat. */
export const CLAIM_GAME_ENDED = 'This game has ended, so its seats can no longer be claimed.';
