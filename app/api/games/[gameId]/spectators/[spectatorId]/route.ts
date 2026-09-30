import { getDb } from '../../../../../../db';
import { changes } from '../../../../../../db/results';
import { ensureDatabase } from '../../../../../../db/migrate';
import { requireGameModerator } from '../../../../../../lib/auth/authorization';
import { assertSameOrigin, jsonError } from '../../../../../../lib/http/security';
import { routeError } from '../../../../../../lib/http/errors';

interface RouteContext {
  params: Promise<{ gameId: string; spectatorId: string }>;
}

/**
 * Removes a spectator. Their link and any signed-in device stop working at
 * once. The row is archived, not deleted, so their Afterlife messages keep an author.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId, spectatorId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const db = getDb();
    const now = new Date().toISOString();
    const result = await db.batch([
      db
        .prepare(
          `UPDATE spectators SET status = 'REMOVED', session_version = session_version + 1, updated_at = ?
           WHERE id = ? AND game_id = ? AND status != 'REMOVED'`,
        )
        .bind(now, spectatorId, gameId),
      db
        .prepare(
          `DELETE FROM spectator_sessions WHERE spectator_id = ?
           AND EXISTS (SELECT 1 FROM spectators WHERE id = ? AND game_id = ? AND status = 'REMOVED' AND updated_at = ?)`,
        )
        .bind(spectatorId, spectatorId, gameId, now),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'SPECTATOR_REMOVED', ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM spectators WHERE id = ? AND game_id = ? AND status = 'REMOVED' AND updated_at = ?)`,
        )
        .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ spectatorId }), now, spectatorId, gameId, now),
    ]);
    if (changes(result[0]) !== 1) return jsonError('That spectator is not in this game.', 404);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to remove the spectator.');
  }
}
