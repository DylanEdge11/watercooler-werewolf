import { cleanText, type Decision } from './signups';

/**
 * Applications to co-moderate a game, taken through the same public link as player sign-ups. The
 * owner approves or declines each one. The rules are here, apart from the routes, so they are
 * unit-tested.
 */

export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'DECLINED';
export type ApplicationDecision = 'APPROVE' | 'DECLINE' | 'RECONSIDER';

export const MAX_APPLICATION_NOTE_LENGTH = 500;
/** Pending and approved applications a game may hold. Declining frees room. */
export const MAX_OPEN_APPLICATIONS = 50;
/** How long an approved applicant has to use their setup link. */
export const SETUP_LINK_DAYS = 7;

/** A game that is over or cancelled takes no more applications. */
const CLOSED_GAME_STATUSES = ['CANCELLED', 'STOPPED', 'COMPLETED'];

export function canTakeApplications(gameStatus: string): Decision {
  if (CLOSED_GAME_STATUSES.includes(gameStatus)) {
    return { allowed: false, error: 'This game has ended, so it can’t take moderator applications.' };
  }
  return { allowed: true };
}

/** Whether the public link offers the application form: the owner has it open and the game is not over. */
export function applicationsAvailable(open: boolean, gameStatus: string): boolean {
  return open && !CLOSED_GAME_STATUSES.includes(gameStatus);
}

/** The applicant's optional note. Returns the cleaned note ('' for none) or an error. */
export function parseApplicationNote(raw: unknown): { ok: true; note: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'The note must be text.' };
  const note = cleanText(raw);
  if (note.length > MAX_APPLICATION_NOTE_LENGTH) return { ok: false, error: `Keep the note to ${MAX_APPLICATION_NOTE_LENGTH} characters or fewer.` };
  return { ok: true, note };
}

/**
 * What a decision does to an application, or null when it doesn't apply. Approving an approved
 * application that has not been used yet issues a fresh link, so a lost link can be replaced.
 * Declining one that has not been used withdraws its link. A used application is final.
 */
export function nextApplicationStatus(current: ApplicationStatus, decision: ApplicationDecision, used: boolean): ApplicationStatus | null {
  if (used) return null;
  if (decision === 'APPROVE') return current === 'PENDING' || current === 'APPROVED' ? 'APPROVED' : null;
  if (decision === 'DECLINE') return current === 'PENDING' || current === 'APPROVED' ? 'DECLINED' : null;
  return current === 'DECLINED' ? 'PENDING' : null;
}

/** When a setup link issued at `decidedAt` stops working. */
export function setupLinkExpiresAt(decidedAt: string): string {
  const expires = new Date(decidedAt);
  expires.setUTCDate(expires.getUTCDate() + SETUP_LINK_DAYS);
  return expires.toISOString();
}

export function setupLinkExpired(decidedAt: string | null, now: Date): boolean {
  if (!decidedAt) return true;
  return new Date(setupLinkExpiresAt(decidedAt)).valueOf() <= now.valueOf();
}
