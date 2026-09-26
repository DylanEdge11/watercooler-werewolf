import { getDb } from '../../../../db';
import { ensureDatabase } from '../../../../db/migrate';
import { sha256, verifySecret } from '../../../../lib/auth/crypto';
import { createPlayerSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../lib/http/rate-limit';

interface LoginSeat {
  id: string;
  gameId: string;
  displayName: string;
  pinHash: string | null;
  sessionVersion: number;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const body = (await request.json()) as { identifier?: string; seatCode?: string; pin?: string };
    const identifier = body.identifier?.trim() ?? body.seatCode?.trim() ?? '';
    const pin = body.pin?.trim() ?? '';
    if (!identifier || !pin) throw new Error('Email or seat code and PIN are required.');
    const isEmail = /^\S+@\S+\.\S+$/u.test(identifier);
    const loginKey = identifier.toLowerCase().slice(0, 80);
    await enforceRateLimit(requestRateLimitKey(request, `seat-login:${loginKey}`), 8, 15 * 60_000);

    const db = getDb();
    let candidateSeats: LoginSeat[];
    if (isEmail) {
      const result = await db
        .prepare(
          `SELECT id, game_id AS gameId, display_name AS displayName, pin_hash AS pinHash,
                  session_version AS sessionVersion
           FROM seats WHERE lower(email) = ? AND status = 'CLAIMED' ORDER BY claimed_at DESC`,
        )
        .bind(identifier.toLowerCase())
        .all<LoginSeat>();
      candidateSeats = result.results;
    } else {
      const seat = await db
        .prepare(
          `SELECT id, game_id AS gameId, display_name AS displayName, pin_hash AS pinHash,
                  session_version AS sessionVersion
           FROM seats WHERE claim_code_hash = ? AND status = 'CLAIMED' LIMIT 1`,
        )
        .bind(await sha256(identifier))
        .first<LoginSeat>();
      candidateSeats = seat ? [seat] : [];
    }
    const matches: LoginSeat[] = [];
    for (const seat of candidateSeats) {
      if (seat.pinHash && await verifySecret(pin, seat.pinHash)) matches.push(seat);
    }
    if (matches.length > 1) {
      return jsonError('This email and PIN match seats in more than one game. Use the seat code from the invitation for the game you want to open.', 409);
    }
    const seat = matches[0];
    if (!seat) {
      return jsonError('Email or seat code and PIN were not accepted.', 401);
    }
    await createPlayerSession(seat.id, seat.sessionVersion);
    return Response.json({ ok: true, seat: { displayName: seat.displayName, gameId: seat.gameId } });
  } catch (error) {
    return routeError(error, 'Unable to sign in.');
  }
}
