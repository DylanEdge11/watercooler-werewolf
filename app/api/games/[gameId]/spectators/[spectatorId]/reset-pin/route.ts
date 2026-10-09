import { getDb } from '@/db';
import { changes } from '@/db/results';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { hashSecret } from '@/lib/auth/crypto';
import { pinFailureKey } from '@/lib/auth/pin-lockout';
import { spectatorLockoutId } from '@/lib/auth/spectator-link';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import type { RouteContext } from '@/lib/http/route-context';

/**
 * Gives a spectator who has chosen a PIN a new one, chosen by the moderator: for
 * a forgotten PIN, or a lockout after 10 wrong PINs in a row. Every device the
 * spectator was signed in on is signed out, the lockout clears, and the new PIN
 * works at once, from the home page with their email or from their private link.
 * The reason and the moderator go in the Operations log; the PIN is never stored
 * or logged in the clear.
 */
export async function POST(request: Request, context: RouteContext<{ gameId: string; spectatorId: string }>) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId, spectatorId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body: unknown = await request.json().catch(() => null);
    const raw = (body && typeof body === 'object' ? body : {}) as { newPin?: unknown; reason?: unknown };
    const newPin = typeof raw.newPin === 'string' ? raw.newPin.trim() : '';
    if (!/^\d{6}$/u.test(newPin)) return jsonError('Choose a six-digit replacement PIN.', 400);
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (reason.length < 5) return jsonError('PIN reset requires a reason of at least 5 characters.', 400);

    const db = getDb();
    const spectator = await db
      .prepare('SELECT id, status, session_version AS sessionVersion FROM spectators WHERE id = ? AND game_id = ? LIMIT 1')
      .bind(spectatorId, gameId)
      .first<{ id: string; status: string; sessionVersion: number }>();
    if (!spectator || spectator.status === 'REMOVED') return jsonError('That spectator is not in this game.', 404);
    if (spectator.status !== 'ACTIVE') return jsonError('This spectator has not opened their link yet. They choose their own PIN the first time they do.', 409);

    const pinHash = await hashSecret(newPin);
    const now = new Date().toISOString();
    const nextVersion = Number(spectator.sessionVersion) + 1;
    // This request's own update: its salted PIN hash is unique to it, so the dependent writes below
    // change nothing if another reset got in first, even within the same millisecond.
    const resetGuard = `EXISTS (
      SELECT 1 FROM spectators
      WHERE id = ? AND game_id = ? AND status = 'ACTIVE' AND session_version = ? AND pin_hash = ?
    )`;
    const result = await db.batch([
      db
        .prepare(
          `UPDATE spectators SET pin_hash = ?, session_version = session_version + 1, updated_at = ?
           WHERE id = ? AND game_id = ? AND status = 'ACTIVE' AND session_version = ?`,
        )
        .bind(pinHash, now, spectator.id, gameId, spectator.sessionVersion),
      db.prepare(`DELETE FROM spectator_sessions WHERE spectator_id = ? AND ${resetGuard}`).bind(spectator.id, spectator.id, gameId, nextVersion, pinHash),
      // A new PIN unlocks a spectator who was locked after too many wrong PINs.
      db.prepare(`DELETE FROM rate_limit_buckets WHERE bucket_key = ? AND ${resetGuard}`).bind(pinFailureKey(spectatorLockoutId(spectator.id)), spectator.id, gameId, nextVersion, pinHash),
      db
        .prepare(
          `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
           SELECT ?, ?, 'WARNING', 'SPECTATOR_ACCESS', 'A spectator PIN was reset by a moderator.', ?, ?
           WHERE ${resetGuard}`,
        )
        .bind(crypto.randomUUID(), gameId, JSON.stringify({ spectatorId: spectator.id, reason, moderatorId: moderator.id }), now, spectator.id, gameId, nextVersion, pinHash),
    ]);
    if (changes(result[0]) !== 1) return jsonError('The spectator changed before their PIN could be reset. Refresh and try again.', 409);
    return Response.json({ ok: true, spectatorId: spectator.id });
  } catch (error) {
    return routeError(error, 'Unable to reset the spectator PIN.');
  }
}
