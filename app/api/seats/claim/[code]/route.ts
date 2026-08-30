import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { createPlayerSession } from '../../../../../lib/auth/session';
import { hashSecret, sha256 } from '../../../../../lib/auth/crypto';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../../lib/http/rate-limit';

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { code } = await context.params;
    const seat = await getD1()
      .prepare(
        `SELECT s.display_name AS displayName, s.status, g.name AS gameName
         FROM seats s JOIN games g ON g.id = s.game_id
         WHERE s.claim_code_hash = ? LIMIT 1`,
      )
      .bind(await sha256(code))
      .first<{ displayName: string; status: string; gameName: string }>();
    if (!seat) return jsonError('This private seat link is not valid.', 404);
    return Response.json({ ok: true, seat });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to look up this seat.', 400);
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

    const db = getD1();
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
    await db.batch([
      db
        .prepare(
          `UPDATE seats SET status = 'CLAIMED', pin_hash = ?, claimed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'INVITED'`,
        )
        .bind(await hashSecret(pin), now, now, seat.id),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_seat_id, payload_json, created_at)
           VALUES (?, ?, 'SEAT_CLAIMED', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), seat.gameId, seat.id, JSON.stringify({ displayName: seat.displayName }), now),
    ]);
    await createPlayerSession(seat.id, seat.sessionVersion);
    return Response.json({ ok: true, seat: { displayName: seat.displayName, gameId: seat.gameId } });
  } catch (error) {
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to claim this seat.', 400);
  }
}
