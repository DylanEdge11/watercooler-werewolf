import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { ensureGameRooms } from '../../../../../lib/chat/rooms';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    await ensureGameRooms(gameId);
    const db = getD1();
    const rooms = await db
      .prepare(
        `SELECT cr.id, cr.type, cr.status, cr.expires_at AS expiresAt,
                COUNT(DISTINCT CASE WHEN crm.access != 'REVOKED' THEN crm.seat_id END) AS memberCount,
                COUNT(DISTINCT cm.id) AS messageCount
         FROM chat_rooms cr
         LEFT JOIN chat_room_members crm ON crm.room_id = cr.id
         LEFT JOIN chat_messages cm ON cm.room_id = cr.id
         WHERE cr.game_id = ? GROUP BY cr.id ORDER BY cr.type`,
      )
      .bind(gameId)
      .all();
    const messages = await db
      .prepare(
        `SELECT cm.id, cm.room_id AS roomId, cr.type AS roomType, s.display_name AS authorName,
                cm.body, cm.deleted_at AS deletedAt, cm.purged_at AS purgedAt, cm.created_at AS createdAt
         FROM chat_messages cm JOIN chat_rooms cr ON cr.id = cm.room_id
         JOIN seats s ON s.id = cm.author_seat_id
         WHERE cr.game_id = ? ORDER BY cm.created_at DESC LIMIT 60`,
      )
      .bind(gameId)
      .all();
    return Response.json({ ok: true, rooms: rooms.results, recentMessages: messages.results });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load private rooms.', 401);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as {
      action?: 'DELETE_MESSAGE' | 'SET_ROOM_STATUS' | 'PURGE_RETENTION';
      messageId?: string;
      roomId?: string;
      status?: 'OPEN' | 'READ_ONLY';
      reason?: string;
    };
    const db = getD1();
    const now = new Date().toISOString();
    if (body.action === 'DELETE_MESSAGE') {
      if (!body.messageId || (body.reason?.trim().length ?? 0) < 5) throw new Error('Choose a message and enter a moderation reason.');
      const message = await db
        .prepare(
          `SELECT cm.id FROM chat_messages cm JOIN chat_rooms cr ON cr.id = cm.room_id
           WHERE cm.id = ? AND cr.game_id = ? LIMIT 1`,
        )
        .bind(body.messageId, gameId)
        .first();
      if (!message) throw new Error('Message not found.');
      await db.batch([
        db
          .prepare('UPDATE chat_messages SET body = NULL, deleted_by_moderator_id = ?, deleted_at = ? WHERE id = ?')
          .bind(moderator.id, now, body.messageId),
        db
          .prepare(
            `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
             VALUES (?, ?, 'WARNING', 'CHAT_MODERATION', 'A private-room message was removed.', ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ messageId: body.messageId, reason: body.reason?.trim() }), now),
      ]);
      return Response.json({ ok: true });
    }
    if (body.action === 'SET_ROOM_STATUS') {
      if (!body.roomId || !body.status) throw new Error('Choose a room and status.');
      const game = await db
        .prepare('SELECT status FROM games WHERE id = ? LIMIT 1')
        .bind(gameId)
        .first<{ status: string }>();
      if (!game) throw new Error('Game not found.');
      if (body.status === 'OPEN' && ['STOPPED', 'COMPLETED', 'CANCELLED'].includes(game.status)) {
        throw new Error('Rooms remain read-only after the game has stopped or completed.');
      }
      await db
        .prepare("UPDATE chat_rooms SET status = ? WHERE id = ? AND game_id = ? AND status != 'PURGED'")
        .bind(body.status, body.roomId, gameId)
        .run();
      return Response.json({ ok: true });
    }
    if (body.action === 'PURGE_RETENTION') {
      const game = await db
        .prepare('SELECT chat_retention_days AS retentionDays FROM games WHERE id = ?')
        .bind(gameId)
        .first<{ retentionDays: number }>();
      if (!game) throw new Error('Game not found.');
      const cutoff = new Date(Date.now() - Number(game.retentionDays) * 86_400_000).toISOString();
      const result = await db
        .prepare(
          `UPDATE chat_messages SET body = NULL, purged_at = ?
           WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?)
           AND created_at < ? AND purged_at IS NULL`,
        )
        .bind(now, gameId, cutoff)
        .run();
      return Response.json({ ok: true, purged: Number(result.meta.changes ?? 0), cutoff });
    }
    throw new Error('Unknown room operation.');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update private rooms.', 400);
  }
}
