import { getDb } from '../../db';
import type { PreparedStatement, SqlValue } from '../../db/contracts';
import { HttpError } from '../http/errors';
import { randomToken } from '../auth/crypto';
import { publicSignupAvailability, type SignupState, type SignupStatus } from '../game/signups';

/**
 * Reads for a game's sign-up list and public link, shared by the moderator routes and the
 * console summary. Writes live in the routes, each as one guarded transaction.
 */

export interface SignupRow {
  id: string;
  displayName: string;
  email: string;
  status: SignupStatus;
  createdAt: string;
}

export interface SignupsView {
  state: SignupState;
  /** True while the public link is taking sign-ups right now. */
  live: boolean;
  note: string;
  /** The public link, once one exists. */
  link: string | null;
  counts: { pending: number; accepted: number; declined: number };
  signups: SignupRow[];
}

/** The public link for a game's code, on the site the moderator is using. */
export function joinLink(origin: string, code: string): string {
  return `${origin}/join/${encodeURIComponent(code)}`;
}

/** A fresh random code for a public link. */
export function newJoinCode(): string {
  return randomToken(9);
}

export async function loadSignupsView(gameId: string, origin: string): Promise<SignupsView> {
  const db = getDb();
  const [game, rows] = await Promise.all([
    db
      .prepare('SELECT status, signup_state AS state, signup_code AS code, signup_note AS note FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ status: string; state: SignupState; code: string | null; note: string | null }>(),
    db
      .prepare(
        `SELECT id, display_name AS displayName, email, status, created_at AS createdAt
         FROM signups WHERE game_id = ? ORDER BY created_at, id`,
      )
      .bind(gameId)
      .all<SignupRow>(),
  ]);
  if (!game) throw new HttpError(404, 'Game not found.');
  const signups = rows.results.map((row) => ({ ...row }));
  const count = (status: SignupStatus) => signups.filter((row) => row.status === status).length;
  return {
    state: game.state,
    live: publicSignupAvailability(game.state, game.status) === 'OPEN',
    note: game.note ?? '',
    link: game.code ? joinLink(origin, game.code) : null,
    counts: { pending: count('PENDING'), accepted: count('ACCEPTED'), declined: count('DECLINED') },
    signups,
  };
}

/** What the console needs on every refresh to show sign-up counts and badges. One row, no lists. */
export interface SignupSummary {
  state: SignupState;
  live: boolean;
  pending: number;
  accepted: number;
  applicationsOpen: boolean;
  pendingApplications: number;
}

export async function loadSignupSummary(gameId: string): Promise<SignupSummary> {
  const row = await getDb()
    .prepare(
      `SELECT g.status AS status, g.signup_state AS state, g.moderator_applications_open AS applicationsOpen,
              (SELECT COUNT(*) FROM signups s WHERE s.game_id = g.id AND s.status = 'PENDING') AS pending,
              (SELECT COUNT(*) FROM signups s WHERE s.game_id = g.id AND s.status = 'ACCEPTED') AS accepted,
              (SELECT COUNT(*) FROM moderator_applications a WHERE a.game_id = g.id AND a.status = 'PENDING') AS pendingApplications
       FROM games g WHERE g.id = ? LIMIT 1`,
    )
    .bind(gameId)
    .first<{ status: string; state: SignupState; applicationsOpen: number; pending: number; accepted: number; pendingApplications: number }>();
  if (!row) throw new HttpError(404, 'Game not found.');
  return {
    state: row.state,
    live: publicSignupAvailability(row.state, row.status) === 'OPEN',
    pending: Number(row.pending),
    accepted: Number(row.accepted),
    applicationsOpen: Boolean(Number(row.applicationsOpen)),
    pendingApplications: Number(row.pendingApplications),
  };
}

/**
 * A person who signed up and has now been put on the roster another way (a pasted list, or added by hand) is
 * shown as accepted, with that seat, so the sign-up list and the roster agree. Part of the roster change's own
 * transaction: `guard` and `guardArgs` are the change's guard, and the seat must exist by the time this runs.
 */
export function markSignupAcceptedStatement(
  db: ReturnType<typeof getDb>,
  change: { gameId: string; seatId: string; email: string; moderatorId: string; now: string },
  guard: string,
  guardArgs: SqlValue[],
): PreparedStatement {
  return db
    .prepare(
      `UPDATE signups SET status = 'ACCEPTED', seat_id = ?, decided_at = ?, decided_by_moderator_id = ?
       WHERE game_id = ? AND email = ? AND status != 'ACCEPTED'
         AND EXISTS (SELECT 1 FROM seats WHERE id = ? AND game_id = ?) AND ${guard}`,
    )
    .bind(change.seatId, change.now, change.moderatorId, change.gameId, change.email, change.seatId, change.gameId, ...guardArgs);
}
