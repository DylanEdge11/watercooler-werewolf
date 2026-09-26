import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { preparePlayerSession } from '../../../../../lib/auth/session';
import { INVALID_CLAIM_LINK, lookupClaimSeat } from '../../../../../lib/auth/claim';
import { pinFailureKey } from '../../../../../lib/auth/pin-lockout';
import { changes } from '../../../../../db/results';
import { hashSecret, sha256 } from '../../../../../lib/auth/crypto';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { routeError } from '../../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../../lib/http/rate-limit';

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
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

export async function POST(request: Request, context: RouteContext) {
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
        `SELECT id, game_id AS gameId, display_name AS displayName, status, session_version AS sessionVersion
         FROM seats WHERE claim_code_hash = ? LIMIT 1`,
      )
      .bind(await sha256(code))
      .first<{
        id: string;
        gameId: string;
        displayName: string;
        status: string;
        sessionVersion: number;
      }>();
    if (!seat) return jsonError('This private seat link is not valid.', 404);
    if (seat.status !== 'INVITED') {
      return jsonError('This seat is already claimed. Use seat sign-in instead.', 409);
    }

    const now = new Date().toISOString();
    const session = await preparePlayerSession(seat.id, Number(seat.sessionVersion));
    // One transaction: the claim, its audit event, and the new session. The
    // claim is conditional on the seat still being INVITED, so when two
    // requests race, the loser changes nothing and gets no session.
    const claimedGuard = "EXISTS (SELECT 1 FROM seats WHERE id = ? AND status = 'CLAIMED' AND claimed_at = ? AND session_version = ?)";
    const result = await db.batch([
      db
        .prepare(
          `UPDATE seats SET status = 'CLAIMED', pin_hash = ?, claimed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'INVITED' AND session_version = ?`,
        )
        .bind(await hashSecret(pin), now, now, seat.id, seat.sessionVersion),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_seat_id, payload_json, created_at)
           SELECT ?, ?, 'SEAT_CLAIMED', ?, ?, ? WHERE ${claimedGuard}`,
        )
        .bind(crypto.randomUUID(), seat.gameId, seat.id, JSON.stringify({ displayName: seat.displayName }), now, seat.id, now, seat.sessionVersion),
      db
        .prepare(
          `INSERT INTO seat_sessions (id, seat_id, token_hash, session_version, expires_at, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${claimedGuard}`,
        )
        .bind(...session.values, seat.id, now, seat.sessionVersion),
      db.prepare(`DELETE FROM rate_limit_buckets WHERE bucket_key = ? AND ${claimedGuard}`).bind(pinFailureKey(seat.id), seat.id, now, seat.sessionVersion),
    ]);
    if (changes(result[0]) !== 1) return jsonError('This seat was claimed by another request. Use seat sign-in instead.', 409);
    await session.setCookie();
    return Response.json({ ok: true, seat: { displayName: seat.displayName, gameId: seat.gameId } });
  } catch (error) {
    return routeError(error, 'Unable to claim this seat.');
  }
}
