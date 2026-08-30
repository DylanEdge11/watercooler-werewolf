import { getD1 } from '../../../../db';
import { ensureDatabase } from '../../../../db/migrate';
import { sha256, verifySecret } from '../../../../lib/auth/crypto';
import { createPlayerSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../lib/http/rate-limit';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const body = (await request.json()) as { seatCode?: string; pin?: string };
    const seatCode = body.seatCode?.trim() ?? '';
    const pin = body.pin?.trim() ?? '';
    if (!seatCode || !pin) throw new Error('Seat code and PIN are required.');
    await enforceRateLimit(requestRateLimitKey(request, `seat-login:${seatCode.slice(0, 80)}`), 8, 15 * 60_000);

    const seat = await getD1()
      .prepare(
        `SELECT id, game_id AS gameId, display_name AS displayName, pin_hash AS pinHash,
                session_version AS sessionVersion
         FROM seats WHERE claim_code_hash = ? AND status = 'CLAIMED' LIMIT 1`,
      )
      .bind(await sha256(seatCode))
      .first<{
        id: string;
        gameId: string;
        displayName: string;
        pinHash: string;
        sessionVersion: number;
      }>();
    if (!seat || !seat.pinHash || !(await verifySecret(pin, seat.pinHash))) {
      return jsonError('Seat code or PIN was not accepted.', 401);
    }
    await createPlayerSession(seat.id, seat.sessionVersion);
    return Response.json({ ok: true, seat: { displayName: seat.displayName, gameId: seat.gameId } });
  } catch (error) {
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to sign in.', 400);
  }
}
