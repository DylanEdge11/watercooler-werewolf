import { getDb } from '../../../../db';
import { ensureDatabase } from '../../../../db/migrate';
import { sha256, verifySecret } from '../../../../lib/auth/crypto';
import { createPlayerSession } from '../../../../lib/auth/session';
import { withoutEndedSpectators } from '../../../../lib/auth/login-matches';
import { clearPinFailures, isPinLocked, PIN_LOCKED_MESSAGE, pinFailureCounts, recordPinFailure } from '../../../../lib/auth/pin-lockout';
import { INVALID_SPECTATOR_LINK, SPECTATOR_LOCKED_MESSAGE, spectatorLockoutId, startSpectatorSession } from '../../../../lib/auth/spectator-link';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../lib/http/rate-limit';
import { isSingleEmailAddress, MAX_EMAIL_LENGTH } from '../../../../lib/roster/email-address';

/** The same answer for every wrong email, seat code, or PIN, so it never reveals which emails have seats. */
const SIGN_IN_NOT_ACCEPTED = 'Email or seat code and PIN were not accepted.';

/** A seat, or a spectator who has already opened their link and chosen a PIN. */
interface LoginCandidate {
  kind: 'SEAT' | 'SPECTATOR';
  id: string;
  gameId: string;
  displayName: string;
  pinHash: string | null;
  sessionVersion: number;
  /** Spectators only: whether their game has ended decides if they can make a sign-in ambiguous. */
  gameStatus?: string;
}

/** Wrong PINs are counted per seat or spectator; a spectator's counter is shared with their private link. */
function lockoutId(candidate: LoginCandidate): string {
  return candidate.kind === 'SPECTATOR' ? spectatorLockoutId(candidate.id) : candidate.id;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const body = (await request.json()) as { identifier?: string; seatCode?: string; pin?: string };
    const identifier = body.identifier?.trim() ?? body.seatCode?.trim() ?? '';
    // Nothing a person can type here is longer than an email address. Refuse longer input at once,
    // before any pattern runs on it and before the rate limiter, so a huge value costs almost nothing.
    if (identifier.length > MAX_EMAIL_LENGTH) return jsonError(SIGN_IN_NOT_ACCEPTED, 401);
    const pin = body.pin?.trim() ?? '';
    if (!identifier || !pin) throw new Error('Email or seat code and PIN are required.');
    // Seat codes never contain "@"; anything that is one plain address is looked up as an email.
    const isEmail = isSingleEmailAddress(identifier.toLowerCase());
    const loginKey = identifier.toLowerCase().slice(0, 80);
    await enforceRateLimit(requestRateLimitKey(request, `seat-login:${loginKey}`), 8, 15 * 60_000);

    const db = getDb();
    let candidates: LoginCandidate[];
    if (isEmail) {
      // A spectator signs in with the email the moderator added, the same way a player does.
      const [seats, spectators] = await Promise.all([
        db
          .prepare(
            `SELECT id, game_id AS gameId, display_name AS displayName, pin_hash AS pinHash,
                    session_version AS sessionVersion
             FROM seats WHERE lower(email) = ? AND status = 'CLAIMED' ORDER BY claimed_at DESC`,
          )
          .bind(identifier.toLowerCase())
          .all<Omit<LoginCandidate, 'kind'>>(),
        db
          .prepare(
            `SELECT sp.id, sp.game_id AS gameId, sp.display_name AS displayName, sp.pin_hash AS pinHash,
                    sp.session_version AS sessionVersion, g.status AS gameStatus
             FROM spectators sp JOIN games g ON g.id = sp.game_id
             WHERE lower(sp.email) = ? AND sp.status = 'ACTIVE' ORDER BY sp.claimed_at DESC`,
          )
          .bind(identifier.toLowerCase())
          .all<Omit<LoginCandidate, 'kind'>>(),
      ]);
      candidates = [
        ...seats.results.map((seat): LoginCandidate => ({ ...seat, kind: 'SEAT' })),
        ...spectators.results.map((spectator): LoginCandidate => ({ ...spectator, kind: 'SPECTATOR' })),
      ];
    } else {
      const seat = await db
        .prepare(
          `SELECT id, game_id AS gameId, display_name AS displayName, pin_hash AS pinHash,
                  session_version AS sessionVersion
           FROM seats WHERE claim_code_hash = ? AND status = 'CLAIMED' LIMIT 1`,
        )
        .bind(await sha256(identifier))
        .first<Omit<LoginCandidate, 'kind'>>();
      candidates = seat ? [{ ...seat, kind: 'SEAT' }] : [];
    }
    // A seat that has had too many wrong PINs in a row is skipped until a moderator resets its PIN.
    const failures = await pinFailureCounts(db, candidates.map(lockoutId));
    const open = candidates.filter((candidate) => !isPinLocked(failures.get(lockoutId(candidate))));
    const matched: LoginCandidate[] = [];
    for (const candidate of open) {
      if (candidate.pinHash && await verifySecret(pin, candidate.pinHash)) matched.push(candidate);
    }
    // A spectator of a finished game never makes someone's sign-in to a running game ambiguous.
    const matches = withoutEndedSpectators(matched);
    if (matches.length > 1) {
      return jsonError(
        matches.every((match) => match.kind === 'SEAT')
          ? 'This email and PIN match seats in more than one game. Use the seat code from the invitation for the game you want to open.'
          : 'This email and PIN match more than one game. Use the seat code or private link from the invitation for the game you want to open.',
        409,
      );
    }
    const match = matches[0];
    if (!match) {
      const now = new Date().toISOString();
      if (open.length) await db.batch(open.map((candidate) => recordPinFailure(db, lockoutId(candidate), now)));
      if (candidates.length && !open.length) {
        return jsonError(candidates.every((candidate) => candidate.kind === 'SPECTATOR') ? SPECTATOR_LOCKED_MESSAGE : PIN_LOCKED_MESSAGE, 423);
      }
      return jsonError(SIGN_IN_NOT_ACCEPTED, 401);
    }
    if (match.kind === 'SPECTATOR') {
      if (!await startSpectatorSession(db, match)) return jsonError(INVALID_SPECTATOR_LINK, 404);
    } else {
      if (failures.has(match.id)) await clearPinFailures(db, match.id).run();
      await createPlayerSession(match.id, match.sessionVersion);
    }
    return Response.json({ ok: true, seat: { displayName: match.displayName, gameId: match.gameId } });
  } catch (error) {
    return routeError(error, 'Unable to sign in.');
  }
}
