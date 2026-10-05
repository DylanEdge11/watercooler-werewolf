import { getDb } from '../../../../db';
import { ensureDatabase } from '../../../../db/migrate';
import { sha256, verifySecret } from '../../../../lib/auth/crypto';
import { createPlayerSession } from '../../../../lib/auth/session';
import { isEndedGameStatus, lockedSeatHiddenByEndedGame, withoutEndedGames, type SignInChoice } from '../../../../lib/auth/login-matches';
import { clearPinFailures, isPinLocked, PIN_LOCKED_MESSAGE, pinFailureCounts, recordPinFailure, SIGN_IN_NOT_ACCEPTED_MESSAGE } from '../../../../lib/auth/pin-lockout';
import { INVALID_SPECTATOR_LINK, SPECTATOR_LOCKED_MESSAGE, spectatorLockoutId, startSpectatorSession } from '../../../../lib/auth/spectator-link';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../lib/http/rate-limit';
import { isSingleEmailAddress, MAX_EMAIL_LENGTH } from '../../../../lib/roster/email-address';

/** A seat, or a spectator who has already opened their link and chosen a PIN. */
interface LoginCandidate {
  kind: 'SEAT' | 'SPECTATOR';
  id: string;
  gameId: string;
  gameName: string;
  /** Whether the game has ended decides if this candidate can make a sign-in ambiguous. */
  gameStatus: string;
  displayName: string;
  pinHash: string | null;
  sessionVersion: number;
}

/** Wrong PINs are counted per seat or spectator; a spectator's counter is shared with their private link. */
function lockoutId(candidate: LoginCandidate): string {
  return candidate.kind === 'SPECTATOR' ? spectatorLockoutId(candidate.id) : candidate.id;
}

const SEAT_COLUMNS = `s.id, s.game_id AS gameId, g.name AS gameName, g.status AS gameStatus, s.display_name AS displayName,
                    s.pin_hash AS pinHash, s.session_version AS sessionVersion`;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const body = (await request.json()) as { identifier?: string; seatCode?: string; pin?: string; choiceId?: string };
    const identifier = body.identifier?.trim() ?? body.seatCode?.trim() ?? '';
    // Nothing a person can type here is longer than an email address. Refuse longer input at once,
    // before any pattern runs on it and before the rate limiter, so a huge value costs almost nothing.
    if (identifier.length > MAX_EMAIL_LENGTH) return jsonError(SIGN_IN_NOT_ACCEPTED_MESSAGE, 401);
    const pin = body.pin?.trim() ?? '';
    if (!identifier || !pin) throw new Error('Email or seat code and PIN are required.');
    // Seat codes never contain "@"; anything that is one plain address is looked up as an email.
    const isEmail = isSingleEmailAddress(identifier.toLowerCase());
    const loginKey = identifier.toLowerCase().slice(0, 80);
    await enforceRateLimit(requestRateLimitKey(request, `seat-login:${loginKey}`), 8, 15 * 60_000);

    const db = getDb();
    let candidates: LoginCandidate[];
    // True when the person picked one game from the "which game?" list.
    let chosen = false;
    if (isEmail) {
      // A spectator signs in with the email the moderator added, the same way a player does.
      const [seats, spectators] = await Promise.all([
        db
          .prepare(
            `SELECT ${SEAT_COLUMNS}
             FROM seats s JOIN games g ON g.id = s.game_id
             WHERE lower(s.email) = ? AND s.status = 'CLAIMED' ORDER BY s.claimed_at DESC`,
          )
          .bind(identifier.toLowerCase())
          .all<Omit<LoginCandidate, 'kind'>>(),
        db
          .prepare(
            `SELECT sp.id, sp.game_id AS gameId, g.name AS gameName, g.status AS gameStatus, sp.display_name AS displayName,
                    sp.pin_hash AS pinHash, sp.session_version AS sessionVersion
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
      // After "which game?", the person's choice names one of this email's own candidates.
      // Anything else matches nothing, so it ends in the same generic answer as a wrong PIN.
      const choiceId = typeof body.choiceId === 'string' ? body.choiceId.trim() : '';
      if (choiceId) {
        candidates = candidates.filter((candidate) => candidate.id === choiceId);
        chosen = true;
      }
    } else {
      const seat = await db
        .prepare(
          `SELECT ${SEAT_COLUMNS}
           FROM seats s JOIN games g ON g.id = s.game_id
           WHERE s.claim_code_hash = ? AND s.status = 'CLAIMED' LIMIT 1`,
        )
        .bind(await sha256(identifier))
        .first<Omit<LoginCandidate, 'kind'>>();
      candidates = seat ? [{ ...seat, kind: 'SEAT' }] : [];
    }
    // A seat that has had too many wrong PINs in a row is skipped until a moderator resets its PIN.
    const failures = await pinFailureCounts(db, candidates.map(lockoutId));
    const open = candidates.filter((candidate) => !isPinLocked(failures.get(lockoutId(candidate))));
    const locked = candidates.filter((candidate) => isPinLocked(failures.get(lockoutId(candidate))));
    const matched: LoginCandidate[] = [];
    for (const candidate of open) {
      if (candidate.pinHash && await verifySecret(pin, candidate.pinHash)) matched.push(candidate);
    }
    // A game that has ended never makes someone's sign-in to a game that has not ended ambiguous.
    // A person who picked one game from the list gets exactly that one.
    const matches = chosen ? matched : withoutEndedGames(matched);
    // The PIN fits only a finished game's seat while a seat in a running game is locked: say so,
    // rather than quietly taking the person to the old game.
    if (!chosen && lockedSeatHiddenByEndedGame(matches, locked)) {
      const lockedRunning = locked.filter((candidate) => !isEndedGameStatus(candidate.gameStatus));
      return jsonError(lockedRunning.every((candidate) => candidate.kind === 'SPECTATOR') ? SPECTATOR_LOCKED_MESSAGE : PIN_LOCKED_MESSAGE, 423);
    }
    if (matches.length > 1) {
      // Safe to list: the email and the PIN are both proven. Only names are sent, never roles, codes, or hashes.
      const choices: SignInChoice[] = matches.map((match) => ({ id: match.id, kind: match.kind, gameName: match.gameName, displayName: match.displayName }));
      return Response.json({ ok: false, error: 'This email and PIN match more than one game. Choose the one you want to open.', choices }, { status: 409 });
    }
    const match = matches[0];
    if (!match) {
      const now = new Date().toISOString();
      if (open.length) await db.batch(open.map((candidate) => recordPinFailure(db, lockoutId(candidate), now)));
      if (candidates.length && !open.length) {
        return jsonError(candidates.every((candidate) => candidate.kind === 'SPECTATOR') ? SPECTATOR_LOCKED_MESSAGE : PIN_LOCKED_MESSAGE, 423);
      }
      return jsonError(SIGN_IN_NOT_ACCEPTED_MESSAGE, 401);
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
