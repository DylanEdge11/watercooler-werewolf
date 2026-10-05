import { getDb } from '../../db';
import { randomToken, sha256 } from '../auth/crypto';
import { MAX_PLAYERS } from '../game/player-count';
import type { RoleComposition } from '../game/types';
import { HttpError } from '../http/errors';
import { applySeatChange, loadEditableRoster } from './edit-roster';
import type { RosterEntry } from './csv';
import { markSignupAcceptedStatement } from './signup-store';

export interface AppendResult {
  added: number;
  /** People on the list who were already on the roster, so they were left as they are. */
  skipped: number;
  playerCount: number;
  composition: RoleComposition;
  resetToPreset: boolean;
  /** One private link per new seat, shown once so the moderator can email or download them. */
  invites: Array<RosterEntry & { claimUrl: string; inviteCode: string }>;
}

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');

/**
 * Adds a pasted list to the roster without touching anyone already on it: people accepted from
 * sign-ups, people imported earlier, and every seat already claimed keep their seat and their link.
 * Someone on the list who is already on the roster is skipped. The new seats, the role counts, and
 * any sign-up from the same email (marked accepted, since they are on the roster now) are one
 * transaction that first claims the roster's setup revision, so a roster edit, a sign-up accepted,
 * or a randomize at the same moment leaves nothing changed (409), as for every roster edit.
 */
export async function appendToRoster(options: { gameId: string; moderatorId: string; entries: readonly RosterEntry[]; origin: string }): Promise<AppendResult> {
  const { gameId, moderatorId, origin } = options;
  const db = getDb();
  const snapshot = await loadEditableRoster(gameId);
  const seats = await db.prepare("SELECT email FROM seats WHERE game_id = ? AND status != 'REMOVED'").bind(gameId).all<{ email: string }>();
  const onRoster = new Set(seats.results.map((seat) => seat.email));
  const fresh = options.entries.filter((entry) => !onRoster.has(entry.email));
  const skipped = options.entries.length - fresh.length;
  if (!fresh.length) throw new HttpError(409, 'Everyone on that list is already on the roster. To start the roster over from this list, use Replace the whole roster.');
  if (snapshot.seatCount + fresh.length > MAX_PLAYERS) {
    const room = Math.max(0, MAX_PLAYERS - snapshot.seatCount);
    throw new HttpError(409, `The roster has ${snapshot.seatCount} players, so this list would make ${snapshot.seatCount + fresh.length}. A game can have at most ${MAX_PLAYERS}, so there is room for ${room} more.`);
  }

  const now = new Date().toISOString();
  const invites = await Promise.all(
    fresh.map(async (entry) => {
      const inviteCode = randomToken(9);
      return { ...entry, seatId: crypto.randomUUID(), inviteCode, codeHash: await sha256(inviteCode), claimUrl: `${origin}/claim/${encodeURIComponent(inviteCode)}` };
    }),
  );
  const result = await applySeatChange({
    gameId,
    moderatorId,
    snapshot,
    delta: invites.length,
    eventType: 'ROSTER_APPENDED',
    eventPayload: { seatIds: invites.map((invite) => invite.seatId), skipped },
    // None of these emails may have reached the roster since it was read.
    extraClaimCondition: {
      sql: `NOT EXISTS (SELECT 1 FROM seats s WHERE s.game_id = games.id AND s.status != 'REMOVED' AND s.email IN (${placeholders(invites.length)}))`,
      args: invites.map((invite) => invite.email),
    },
    seatStatements: (guard, guardArgs) => invites.flatMap((invite) => [
      db
        .prepare(
          `INSERT INTO seats
           (id, game_id, display_name, email, status, claim_code_hash, session_version, alive, created_at, updated_at)
           SELECT ?, ?, ?, ?, 'INVITED', ?, 1, 1, ?, ? WHERE ${guard}`,
        )
        .bind(invite.seatId, gameId, invite.displayName, invite.email, invite.codeHash, now, now, ...guardArgs),
      // Someone who signed up and is also on this list is on the roster now, so the sign-up list says so.
      markSignupAcceptedStatement(db, { gameId, seatId: invite.seatId, email: invite.email, moderatorId, now }, guard, guardArgs),
    ]),
  });
  return {
    added: invites.length,
    skipped,
    playerCount: result.playerCount,
    composition: result.composition,
    resetToPreset: result.resetToPreset,
    invites: invites.map((invite) => ({ displayName: invite.displayName, email: invite.email, claimUrl: invite.claimUrl, inviteCode: invite.inviteCode })),
  };
}
