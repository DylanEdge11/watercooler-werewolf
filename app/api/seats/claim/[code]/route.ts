import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { preparePlayerSession } from '@/lib/auth/session';
import { CLAIM_GAME_ENDED, INVALID_CLAIM_LINK, lookupClaimSeat } from '@/lib/auth/claim';
import { ENDED_GAME_STATUSES, isEndedGameStatus } from '@/lib/auth/login-matches';
import { pinFailureKey } from '@/lib/auth/pin-lockout';
import { changes } from '@/db/results';
import { townHallJoinStatement } from '@/lib/chat/rooms';
import { hashSecret, sha256 } from '@/lib/auth/crypto';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '@/lib/http/rate-limit';
import type { RouteContext } from '@/lib/http/route-context';

export async function GET(_request: Request, context: RouteContext<{ code: string }>) {
  try {
    await ensureDatabase();
    const { code } = await context.params;
    const seat = await lookupClaimSeat(code);
    if (!seat) return jsonError(INVALID_CLAIM_LINK, 404);
    return Response.json({ ok: true, seat });
  } catch (error) {
    return routeError(error, 'Unable to look up this seat.');
  }
}

export async function POST(request: Request, context: RouteContext<{ code: string }>) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { code } = await context.params;
    const body = (await request.json()) as { pin?: string };
    const pin = body.pin?.trim() ?? '';
    if (!/^\d{6}$/u.test(pin)) throw new Error('Choose a six-digit PIN.');
    await enforceRateLimit(requestRateLimitKey(request, `seat-claim:${code.slice(0, 80)}`), 3, 60 * 60_000);

    const db = getDb();
    const seat = await db
      .prepare(
        `SELECT s.id, s.game_id AS gameId, s.display_name AS displayName, s.status, s.session_version AS sessionVersion,
                g.status AS gameStatus
         FROM seats s JOIN games g ON g.id = s.game_id WHERE s.claim_code_hash = ? LIMIT 1`,
      )
      .bind(await sha256(code))
      .first<{
        id: string;
        gameId: string;
        displayName: string;
        status: string;
        sessionVersion: number;
        gameStatus: string;
      }>();
    if (!seat) return jsonError('This private seat link is not valid.', 404);
    if (seat.status !== 'INVITED') {
      return jsonError('This seat is already claimed. Use seat sign-in instead.', 409);
    }
    // A leftover invitation to a game that has ended must not create a second seat that the same email and PIN could reach.
    if (isEndedGameStatus(seat.gameStatus)) return jsonError(CLAIM_GAME_ENDED, 409);

    const now = new Date().toISOString();
    const pinHash = await hashSecret(pin);
    const session = await preparePlayerSession(seat.id, Number(seat.sessionVersion));
    // One transaction: the claim, its audit event, and the new session. The
    // claim is conditional on the seat still being INVITED, so when two
    // requests race, the loser changes nothing and gets no session. The salted
    // PIN hash identifies this request's claim; two claims can share a timestamp. The claim also
    // requires the game not to have ended, in case it ends between the read above and this write.
    const claimedGuard = "EXISTS (SELECT 1 FROM seats WHERE id = ? AND status = 'CLAIMED' AND claimed_at = ? AND pin_hash = ? AND session_version = ?)";
    const result = await db.batch([
      db
        .prepare(
          `UPDATE seats SET status = 'CLAIMED', pin_hash = ?, claimed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'INVITED' AND session_version = ?
             AND EXISTS (SELECT 1 FROM games WHERE games.id = seats.game_id AND games.status NOT IN (${ENDED_GAME_STATUSES.map(() => '?').join(', ')}))`,
        )
        .bind(pinHash, now, now, seat.id, seat.sessionVersion, ...ENDED_GAME_STATUSES),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_seat_id, payload_json, created_at)
           SELECT ?, ?, 'SEAT_CLAIMED', ?, ?, ? WHERE ${claimedGuard}`,
        )
        .bind(crypto.randomUUID(), seat.gameId, seat.id, JSON.stringify({ displayName: seat.displayName }), now, seat.id, now, pinHash, seat.sessionVersion),
      db
        .prepare(
          `INSERT INTO seat_sessions (id, seat_id, token_hash, session_version, expires_at, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${claimedGuard}`,
        )
        .bind(...session.values, seat.id, now, pinHash, seat.sessionVersion),
      db.prepare(`DELETE FROM rate_limit_buckets WHERE bucket_key = ? AND ${claimedGuard}`).bind(pinFailureKey(seat.id), seat.id, now, pinHash, seat.sessionVersion),
      townHallJoinStatement(db, seat.id, now),
    ]);
    if (changes(result[0]) !== 1) {
      // Either another request claimed the seat first, or the game ended just now; tell the person which.
      const game = await db.prepare('SELECT status FROM games WHERE id = ?').bind(seat.gameId).first<{ status: string }>();
      if (game && isEndedGameStatus(game.status)) return jsonError(CLAIM_GAME_ENDED, 409);
      return jsonError('This seat was claimed by another request. Use seat sign-in instead.', 409);
    }
    await session.setCookie();
    return Response.json({ ok: true, seat: { displayName: seat.displayName, gameId: seat.gameId } });
  } catch (error) {
    return routeError(error, 'Unable to claim this seat.');
  }
}
