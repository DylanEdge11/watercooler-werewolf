import { getDb } from '../../db';
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
