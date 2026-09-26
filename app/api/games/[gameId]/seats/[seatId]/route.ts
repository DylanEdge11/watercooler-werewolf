import { getDb } from '../../../../../../db';
import { ensureDatabase } from '../../../../../../db/migrate';
import { requireGameModerator } from '../../../../../../lib/auth/authorization';
import { randomToken, sha256 } from '../../../../../../lib/auth/crypto';
import { canRemoveSeat } from '../../../../../../lib/game/roster-edit';
import { assertSameOrigin, jsonError } from '../../../../../../lib/http/security';
import { routeError } from '../../../../../../lib/http/errors';
import { applySeatChange, loadEditableRoster } from '../../../../../../lib/roster/edit-roster';

interface RouteContext {
  params: Promise<{ gameId: string; seatId: string }>;
}

/**
 * Removes one player who has not claimed their seat, before roles are
 * randomized. Their invitation link stops working. The seat is archived, not
 * deleted, so audit history that names it stays intact.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId, seatId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const db = getDb();
    const seat = await db
      .prepare("SELECT status FROM seats WHERE id = ? AND game_id = ? AND status != 'REMOVED' LIMIT 1")
      .bind(seatId, gameId)
      .first<{ status: string }>();
    if (!seat) return jsonError('That player is not on the roster.', 404);
    const snapshot = await loadEditableRoster(gameId);
    const decision = canRemoveSeat(snapshot.seatCount, seat.status);
    if (!decision.allowed) return jsonError(decision.error, 409);

    const archivedHash = await sha256(randomToken(18));
    const now = new Date().toISOString();
    const result = await applySeatChange({
      gameId,
      moderatorId: moderator.id,
      snapshot,
      delta: -1,
      eventType: 'SEAT_REMOVED',
      eventPayload: { seatId },
      // A player who claims first wins; the removal then changes nothing.
      extraClaimCondition: {
        sql: "EXISTS (SELECT 1 FROM seats s WHERE s.id = ? AND s.game_id = games.id AND s.status = 'INVITED')",
        args: [seatId],
      },
      seatStatements: (guard, guardArgs) => [
        db
          .prepare(
            `UPDATE seats SET status = 'REMOVED', email = 'archived+' || id || '@invalid.test',
                              claim_code_hash = ?, pin_hash = NULL, session_version = session_version + 1,
                              alive = 0, claimed_at = NULL, updated_at = ?
             WHERE id = ? AND game_id = ? AND status = 'INVITED' AND ${guard}`,
          )
          .bind(archivedHash, now, seatId, gameId, ...guardArgs),
        db.prepare(`DELETE FROM seat_sessions WHERE seat_id = ? AND ${guard}`).bind(seatId, ...guardArgs),
      ],
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return routeError(error, 'Unable to remove the player.');
  }
}
