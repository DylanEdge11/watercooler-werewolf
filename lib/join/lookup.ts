import { getDb } from '../../db';
import { applicationsAvailable } from '../game/moderator-applications';
import { formatStartDate, publicSignupAvailability } from '../game/signups';

/**
 * What the public /join/<code> page may know about a game: its name, start date, and the
 * moderator's note, plus which forms are open. Nothing about who has signed up or applied.
 */
export interface JoinPage {
  gameId: string;
  gameName: string;
  startDateLabel: string;
  note: string;
  /** OPEN takes sign-ups; CLOSED and NOT_OPEN do not. */
  signups: 'OPEN' | 'CLOSED' | 'NOT_OPEN';
  applications: boolean;
}

/** Codes are short random tokens; anything else can't match and never reaches the database. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/u;

export async function lookupJoinPage(code: string): Promise<JoinPage | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const game = await getDb()
    .prepare(
      `SELECT id, name, start_date AS startDate, status, signup_state AS signupState, signup_note AS note,
              moderator_applications_open AS applicationsOpen
       FROM games WHERE signup_code = ? LIMIT 1`,
    )
    .bind(code)
    .first<{ id: string; name: string; startDate: string; status: string; signupState: string; note: string | null; applicationsOpen: number }>();
  if (!game) return null;
  return {
    gameId: game.id,
    gameName: game.name,
    startDateLabel: formatStartDate(game.startDate),
    note: game.note ?? '',
    signups: publicSignupAvailability(game.signupState, game.status),
    applications: applicationsAvailable(Boolean(Number(game.applicationsOpen)), game.status),
  };
}

/** The part of a join page the browser is given. The game's id stays on the server. */
export type PublicJoinPage = Omit<JoinPage, 'gameId'>;

export function toPublicJoinPage(page: JoinPage): PublicJoinPage {
  return { gameName: page.gameName, startDateLabel: page.startDateLabel, note: page.note, signups: page.signups, applications: page.applications };
}
