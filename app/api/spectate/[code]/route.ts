import { getDb } from '@/db';
import { changes } from '@/db/results';
import { ensureDatabase } from '@/db/migrate';
import { hashSecret, sha256, verifySecret } from '@/lib/auth/crypto';
import { clearPinFailures, isPinLocked, pinFailureCounts, recordPinFailure } from '@/lib/auth/pin-lockout';
import { prepareSpectatorSession } from '@/lib/auth/session';
import { INVALID_SPECTATOR_LINK, lookupSpectatorLink, SPECTATOR_LOCKED_MESSAGE, spectatorLockoutId } from '@/lib/auth/spectator-link';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '@/lib/http/rate-limit';
import type { RouteContext } from '@/lib/http/route-context';

export async function GET(_request: Request, context: RouteContext<{ code: string }>) {
  try {
    await ensureDatabase();
    const { code } = await context.params;
    const spectator = await lookupSpectatorLink(code);
    if (!spectator) return jsonError(INVALID_SPECTATOR_LINK, 404);
    return Response.json({ ok: true, spectator });
  } catch (error) {
    return routeError(error, 'Unable to look up this spectator link.');
  }
}

/**
 * The first visit chooses a PIN; later visits sign in with it. Either way the
 * device gets a spectator session. Once a spectator has a PIN they can also sign
 * in from the home page with their email (POST /api/seats/login); the wrong-PIN
 * count is shared, and only a moderator's PIN reset clears a lockout.
 */
export async function POST(request: Request, context: RouteContext<{ code: string }>) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { code } = await context.params;
    const body = (await request.json()) as { pin?: string };
    const pin = body.pin?.trim() ?? '';
    if (!/^\d{6}$/u.test(pin)) throw new Error('Enter a six-digit PIN.');
    await enforceRateLimit(requestRateLimitKey(request, `spectate:${code.slice(0, 80)}`), 8, 15 * 60_000);

    const db = getDb();
    const spectator = await db
      .prepare(
        `SELECT id, game_id AS gameId, display_name AS displayName, status, pin_hash AS pinHash,
                session_version AS sessionVersion
         FROM spectators WHERE claim_code_hash = ? AND status != 'REMOVED' LIMIT 1`,
      )
      .bind(await sha256(code))
      .first<{ id: string; gameId: string; displayName: string; status: string; pinHash: string | null; sessionVersion: number }>();
    if (!spectator) return jsonError(INVALID_SPECTATOR_LINK, 404);
    const session = await prepareSpectatorSession(spectator.id, Number(spectator.sessionVersion));
    const insertSession = (guard: string, ...guardArgs: Array<string | number>) => db
      .prepare(
        `INSERT INTO spectator_sessions (id, spectator_id, token_hash, session_version, expires_at, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      )
      .bind(...session.values, ...guardArgs);

    if (spectator.status === 'INVITED') {
      const now = new Date().toISOString();
      const pinHash = await hashSecret(pin);
      // The salted PIN hash marks this request's claim, so of two racing first visits only one gets a session.
      const claimedGuard = "EXISTS (SELECT 1 FROM spectators WHERE id = ? AND status = 'ACTIVE' AND pin_hash = ? AND session_version = ?)";
      const result = await db.batch([
        db
          .prepare(
            `UPDATE spectators SET status = 'ACTIVE', pin_hash = ?, claimed_at = ?, updated_at = ?
             WHERE id = ? AND status = 'INVITED' AND session_version = ?`,
          )
          .bind(pinHash, now, now, spectator.id, spectator.sessionVersion),
        insertSession(claimedGuard, spectator.id, pinHash, spectator.sessionVersion),
      ]);
      if (changes(result[0]) !== 1) return jsonError('This link was just used on another device. Enter the PIN chosen there.', 409);
      await session.setCookie();
      return Response.json({ ok: true, claimed: true, spectator: { displayName: spectator.displayName, gameId: spectator.gameId } });
    }

    const lockoutId = spectatorLockoutId(spectator.id);
    const failures = await pinFailureCounts(db, [lockoutId]);
    if (isPinLocked(failures.get(lockoutId))) return jsonError(SPECTATOR_LOCKED_MESSAGE, 423);
    if (!spectator.pinHash || !(await verifySecret(pin, spectator.pinHash))) {
      await recordPinFailure(db, lockoutId, new Date().toISOString()).run();
      return jsonError('That PIN was not accepted.', 401);
    }
    const result = await db.batch([
      insertSession("EXISTS (SELECT 1 FROM spectators WHERE id = ? AND status = 'ACTIVE' AND session_version = ?)", spectator.id, spectator.sessionVersion),
      clearPinFailures(db, lockoutId),
    ]);
    if (changes(result[0]) !== 1) return jsonError(INVALID_SPECTATOR_LINK, 404);
    await session.setCookie();
    return Response.json({ ok: true, claimed: false, spectator: { displayName: spectator.displayName, gameId: spectator.gameId } });
  } catch (error) {
    return routeError(error, 'Unable to open this spectator link.');
  }
}
