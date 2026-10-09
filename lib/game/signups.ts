import { isSingleEmailAddress } from '../roster/email-address';
import { MAX_PLAYERS } from './player-count';

/**
 * Public sign-up for a game: the rules, kept apart from the routes so they are
 * unit-tested. A moderator opens sign-ups, shares the link, and accepts the people
 * they want; accepting creates an ordinary unclaimed seat (see lib/roster/accept-signups.ts).
 */

export type SignupState = 'NOT_OPEN' | 'OPEN' | 'CLOSED';
export type SignupStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

export const MAX_NAME_LENGTH = 80;
export const MAX_SIGNUP_NOTE_LENGTH = 300;
/** Pending and accepted sign-ups a game's list may hold. Declining frees room, so a flood of junk can be cleared. */
export const MAX_OPEN_SIGNUPS = 300;

/** Statuses where sign-ups can be opened and accepted: before roles are randomized (the roster is editable). */
const SIGNUP_GAME_STATUSES = ['DRAFT', 'REGISTRATION'];
/** Statuses where the list can still be reviewed (declined, put back). */
const REVIEW_GAME_STATUSES = ['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'];

export type Decision = { allowed: true } | { allowed: false; error: string };

export function canOpenSignups(status: string, rolesReleased: boolean): Decision {
  if (rolesReleased || !SIGNUP_GAME_STATUSES.includes(status)) {
    return { allowed: false, error: 'Sign-ups can be opened only before roles are randomized.' };
  }
  return { allowed: true };
}

/** Closing is always allowed; closing a link that is not open changes nothing. */
export function nextSignupState(current: SignupState, action: 'OPEN' | 'CLOSE'): SignupState {
  if (action === 'OPEN') return 'OPEN';
  return current === 'OPEN' ? 'CLOSED' : current;
}

/**
 * What the public link offers right now. It is open only while the moderator has it open and the
 * roster can still change, so randomizing the roles pauses sign-ups until the roster is unlocked.
 */
export function publicSignupAvailability(state: string, gameStatus: string): 'OPEN' | 'CLOSED' | 'NOT_OPEN' {
  if (state === 'NOT_OPEN') return 'NOT_OPEN';
  return state === 'OPEN' && SIGNUP_GAME_STATUSES.includes(gameStatus) ? 'OPEN' : 'CLOSED';
}

export function canReviewSignups(status: string, rolesReleased: boolean): Decision {
  if (rolesReleased || !REVIEW_GAME_STATUSES.includes(status)) {
    return { allowed: false, error: 'Sign-ups can be reviewed only before the game starts.' };
  }
  return { allowed: true };
}

/** Collapses runs of whitespace and drops control characters. Returns '' when nothing usable is left. */
export function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export type ParsedPerson = { ok: true; displayName: string; email: string } | { ok: false; error: string };

/** A name and one plain email address, as typed on a public form. */
export function parsePerson(body: unknown): ParsedPerson {
  const raw = (body && typeof body === 'object' ? body : {}) as { displayName?: unknown; email?: unknown };
  const displayName = cleanText(raw.displayName);
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (!displayName || displayName.length > MAX_NAME_LENGTH) return { ok: false, error: `Enter your name, up to ${MAX_NAME_LENGTH} characters.` };
  if (email.length > 254 || !isSingleEmailAddress(email)) return { ok: false, error: 'Enter one plain email address, like name@example.com.' };
  return { ok: true, displayName, email };
}

/** A hidden form field real visitors never fill in. Bots that fill every field get a success page and no row. */
export function honeypotFilled(body: unknown): boolean {
  const value = (body && typeof body === 'object' ? (body as { website?: unknown }).website : undefined);
  return typeof value === 'string' && value.trim().length > 0;
}

/** The moderator's optional note on the sign-up page. Returns the cleaned note ('' for none) or an error. */
export function parseSignupNote(raw: unknown): { ok: true; note: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'The note must be text.' };
  const note = raw.replace(/\r\n?/gu, '\n').replace(/[^\S\n]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(note)) return { ok: false, error: 'The note contains characters that can’t be shown.' };
  if (note.length > MAX_SIGNUP_NOTE_LENGTH) return { ok: false, error: `Keep the note to ${MAX_SIGNUP_NOTE_LENGTH} characters or fewer.` };
  return { ok: true, note };
}

/** "Monday, October 6" from a game's YYYY-MM-DD start date, or the date as written if it can't be read. */
export function formatStartDate(startDate: string): string {
  const parsed = new Date(`${startDate}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return startDate;
  return parsed.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
}

export interface PendingSignup {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
}

export interface AcceptancePlan {
  /** Get a new seat, oldest sign-up first. */
  add: PendingSignup[];
  /** Already on the roster under the same email, so they only need marking accepted. */
  onRoster: PendingSignup[];
  /** Left waiting because the roster has no room. */
  full: PendingSignup[];
}

/** Which of the chosen sign-ups become new seats, given the roster as it stands. */
export function planAcceptance(input: { signups: readonly PendingSignup[]; seatCount: number; rosterEmails: ReadonlySet<string> }): AcceptancePlan {
  const plan: AcceptancePlan = { add: [], onRoster: [], full: [] };
  const ordered = [...input.signups].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const signup of ordered) {
    if (input.rosterEmails.has(signup.email)) plan.onRoster.push(signup);
    else if (input.seatCount + plan.add.length >= MAX_PLAYERS) plan.full.push(signup);
    else plan.add.push(signup);
  }
  return plan;
}

/** One line for the moderator after accepting. */
export function describeAcceptance(plan: AcceptancePlan): string {
  const added = plan.add.length;
  const parts = [`${added} ${added === 1 ? 'player' : 'players'} added to the roster.`];
  if (plan.onRoster.length) parts.push(`${plan.onRoster.length} ${plan.onRoster.length === 1 ? 'was' : 'were'} already on it.`);
  if (plan.full.length) parts.push(`${plan.full.length} ${plan.full.length === 1 ? 'is' : 'are'} still waiting because a game holds at most ${MAX_PLAYERS} players.`);
  return parts.join(' ');
}
