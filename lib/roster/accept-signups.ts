import { getDb } from '../../db';
import type { SqlValue } from '../../db/contracts';
import { changes } from '../../db/results';
import { randomToken, sha256 } from '../auth/crypto';
import { canAcceptSignups } from '../game/roster-edit';
import { describeAcceptance, planAcceptance, type PendingSignup } from '../game/signups';
import type { RoleComposition } from '../game/types';
import { HttpError } from '../http/errors';
import { applySeatChange, loadEditableRoster } from './edit-roster';

export interface AcceptedInvite {
  displayName: string;
  email: string;
  claimUrl: string;
  inviteCode: string;
}

export interface AcceptResult {
  added: number;
  onRoster: number;
  waiting: number;
  message: string;
  composition: RoleComposition;
  resetToPreset: boolean;
  playerCount: number;
  /** One private link per new seat, shown once so the moderator can email or download them. */
  invites: AcceptedInvite[];
}

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');

/**
 * Turns the chosen waiting sign-ups into unclaimed seats, exactly as if the moderator had added
 * each player by hand: the same invitation email, invite CSV, and claim with a PIN follow.
 * All the new seats, the role counts, and the sign-ups' new status are one transaction that
 * claims the roster's setup revision first, so a roster edit, a randomize, or a sign-up declined
 * a moment earlier leaves nothing changed (409). Anyone already on the roster under the same
 * email is marked accepted without a second seat.
 */
export async function acceptSignups(options: { gameId: string; moderatorId: string; signupIds: string[]; origin: string }): Promise<AcceptResult> {
  const { gameId, moderatorId, origin } = options;
  const db = getDb();
  const snapshot = await loadEditableRoster(gameId);
  const ids = [...new Set(options.signupIds)];
  const [pending, seats] = await Promise.all([
    db
      .prepare(
        `SELECT id, display_name AS displayName, email, created_at AS createdAt
         FROM signups WHERE game_id = ? AND status = 'PENDING' AND id IN (${placeholders(ids.length)})`,
      )
      .bind(gameId, ...ids)
      .all<PendingSignup>(),
    db.prepare("SELECT email FROM seats WHERE game_id = ? AND status != 'REMOVED'").bind(gameId).all<{ email: string }>(),
  ]);
  if (!pending.results.length) throw new HttpError(409, 'Those sign-ups have already been dealt with. Refresh the list.');

  const plan = planAcceptance({ signups: pending.results, seatCount: snapshot.seatCount, rosterEmails: new Set(seats.results.map((seat) => seat.email)) });
  if (!plan.add.length && !plan.onRoster.length) {
    // Nobody can be added, so say why: a full roster has its own message. People already seated are still accepted, as below.
    const room = canAcceptSignups(snapshot.seatCount);
    throw new HttpError(409, room.allowed ? describeAcceptance(plan) : room.error);
  }

  const now = new Date().toISOString();
  const invites = await Promise.all(
    plan.add.map(async (signup) => {
      const inviteCode = randomToken(9);
      return { signup, seatId: crypto.randomUUID(), inviteCode, codeHash: await sha256(inviteCode), claimUrl: `${origin}/claim/${encodeURIComponent(inviteCode)}` };
    }),
  );

  const markOnRoster = (signup: PendingSignup, guard: string, guardArgs: SqlValue[]) => db
    .prepare(
      `UPDATE signups
       SET status = 'ACCEPTED',
           seat_id = (SELECT id FROM seats WHERE game_id = signups.game_id AND email = signups.email AND status != 'REMOVED' LIMIT 1),
           decided_at = ?, decided_by_moderator_id = ?
       WHERE id = ? AND game_id = ? AND status = 'PENDING'
         AND EXISTS (SELECT 1 FROM seats WHERE game_id = signups.game_id AND email = signups.email AND status != 'REMOVED')
         AND ${guard}`,
    )
    .bind(now, moderatorId, signup.id, gameId, ...guardArgs);

  let composition = snapshot.composition;
  let resetToPreset = false;
  let playerCount = snapshot.seatCount;
  // How many people already on the roster were marked accepted by this request.
  let markedOnRoster = plan.onRoster.length;
  if (invites.length) {
    const addIds = invites.map((invite) => invite.signup.id);
    const result = await applySeatChange({
      gameId,
      moderatorId,
      snapshot,
      delta: invites.length,
      eventType: 'SIGNUPS_ACCEPTED',
      eventPayload: { signupIds: [...addIds, ...plan.onRoster.map((signup) => signup.id)], seatIds: invites.map((invite) => invite.seatId) },
      // Every chosen sign-up must still be waiting, or none of this applies.
      extraClaimCondition: {
        sql: `(SELECT COUNT(*) FROM signups sg WHERE sg.game_id = games.id AND sg.status = 'PENDING' AND sg.id IN (${placeholders(addIds.length)})) = ?`,
        args: [...addIds, addIds.length],
      },
      seatStatements: (guard, guardArgs) => [
        ...invites.flatMap((invite) => [
          db
            .prepare(
              `INSERT INTO seats
               (id, game_id, display_name, email, status, claim_code_hash, session_version, alive, created_at, updated_at)
               SELECT ?, ?, ?, ?, 'INVITED', ?, 1, 1, ?, ?
               WHERE ${guard} AND EXISTS (SELECT 1 FROM signups WHERE id = ? AND game_id = ? AND status = 'PENDING')`,
            )
            .bind(invite.seatId, gameId, invite.signup.displayName, invite.signup.email, invite.codeHash, now, now, ...guardArgs, invite.signup.id, gameId),
          db
            .prepare(
              `UPDATE signups SET status = 'ACCEPTED', seat_id = ?, decided_at = ?, decided_by_moderator_id = ?
               WHERE id = ? AND game_id = ? AND status = 'PENDING'
                 AND EXISTS (SELECT 1 FROM seats WHERE id = ? AND game_id = ?) AND ${guard}`,
            )
            .bind(invite.seatId, now, moderatorId, invite.signup.id, gameId, invite.seatId, gameId, ...guardArgs),
        ]),
        ...plan.onRoster.map((signup) => markOnRoster(signup, guard, guardArgs)),
      ],
    });
    ({ composition, resetToPreset, playerCount } = result);
  } else {
    const guard = "EXISTS (SELECT 1 FROM games g WHERE g.id = ? AND g.status IN ('DRAFT', 'REGISTRATION') AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = g.id))";
    const results = await db.batch(plan.onRoster.map((signup) => markOnRoster(signup, guard, [gameId])));
    markedOnRoster = results.filter((result) => changes(result) === 1).length;
    // Nothing changed means the game moved on, or each sign-up was dealt with, between reading and writing.
    if (!markedOnRoster) throw new HttpError(409, 'The roster or the list changed while you were working. Refresh and try again.');
  }

  return {
    added: invites.length,
    onRoster: markedOnRoster,
    waiting: plan.full.length,
    message: describeAcceptance(plan),
    composition,
    resetToPreset,
    playerCount,
    invites: invites.map((invite) => ({ displayName: invite.signup.displayName, email: invite.signup.email, claimUrl: invite.claimUrl, inviteCode: invite.inviteCode })),
  };
}
