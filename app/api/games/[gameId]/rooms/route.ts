import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { ensureGameRoomsExist } from '@/lib/chat/rooms';
import { roomMessageAuthorName, type RoomMessageAuthor } from '@/lib/chat/room-messages';
import { changes } from '@/db/results';
import { assertSameOrigin } from '@/lib/http/security';
import { HttpError, routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import type { RouteContext } from '@/lib/http/route-context';

/** Every table that holds room messages; removal and retention purges cover all of them. */
const MESSAGE_TABLES = ['chat_messages', 'spectator_messages', 'moderator_messages'] as const;

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    await ensureGameRoomsExist(gameId);
    const db = getDb();
    const rooms = await db
      .prepare(
        `SELECT cr.id, cr.type, cr.status, cr.expires_at AS expiresAt,
                (SELECT COUNT(*) FROM chat_room_members crm
                 WHERE crm.room_id = cr.id AND crm.access != 'REVOKED') AS memberCount,
                (SELECT COUNT(*) FROM chat_messages cm WHERE cm.room_id = cr.id)
                  + (SELECT COUNT(*) FROM spectator_messages sm WHERE sm.room_id = cr.id)
                  + (SELECT COUNT(*) FROM moderator_messages mm WHERE mm.room_id = cr.id) AS messageCount
         FROM chat_rooms cr
         WHERE cr.game_id = ? ORDER BY cr.type`,
      )
      .bind(gameId)
      .all();
    const messages = await db
      .prepare(
        `SELECT cm.id, cm.room_id AS roomId, cr.type AS roomType, s.display_name AS authorName, 'PLAYER' AS authorKind,
                cm.body, cm.deleted_at AS deletedAt, cm.purged_at AS purgedAt, cm.created_at AS createdAt
         FROM chat_messages cm JOIN chat_rooms cr ON cr.id = cm.room_id
         JOIN seats s ON s.id = cm.author_seat_id
         WHERE cr.game_id = ?
         UNION ALL
         SELECT sm.id, sm.room_id, cr.type, sp.display_name, 'SPECTATOR',
                sm.body, sm.deleted_at, sm.purged_at, sm.created_at
         FROM spectator_messages sm JOIN chat_rooms cr ON cr.id = sm.room_id
         JOIN spectators sp ON sp.id = sm.spectator_id
         WHERE cr.game_id = ?
         UNION ALL
         SELECT mm.id, mm.room_id, cr.type, NULL, 'MODERATOR',
                mm.body, mm.deleted_at, mm.purged_at, mm.created_at
         FROM moderator_messages mm JOIN chat_rooms cr ON cr.id = mm.room_id
         WHERE cr.game_id = ?
         ORDER BY createdAt DESC LIMIT 60`,
      )
      .bind(gameId, gameId, gameId)
      .all<{ authorName: string | null; authorKind: RoomMessageAuthor }>();
    const recentMessages = messages.results.map((message) => ({
      ...message,
      authorName: roomMessageAuthorName(message.authorKind, message.authorName),
    }));
    return respondJsonWithEtag(request, { ok: true, rooms: rooms.results, recentMessages });
  } catch (error) {
    return routeError(error, 'Unable to load private rooms.');
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
      status?: unknown;
      reason?: string;
    };
    const db = getDb();
    const now = new Date().toISOString();
    if (body.action === 'DELETE_MESSAGE') {
      if (!body.messageId || (body.reason?.trim().length ?? 0) < 5) throw new Error('Choose a message and enter a moderation reason.');
      // A message id names a player's, a spectator's, or a moderator's message; exactly one table holds it.
      const message = await db
        .prepare(
          `SELECT 'chat_messages' AS source FROM chat_messages cm JOIN chat_rooms cr ON cr.id = cm.room_id
           WHERE cm.id = ? AND cr.game_id = ?
           UNION ALL
           SELECT 'spectator_messages' FROM spectator_messages sm JOIN chat_rooms cr ON cr.id = sm.room_id
           WHERE sm.id = ? AND cr.game_id = ?
           UNION ALL
           SELECT 'moderator_messages' FROM moderator_messages mm JOIN chat_rooms cr ON cr.id = mm.room_id
           WHERE mm.id = ? AND cr.game_id = ?
           LIMIT 1`,
        )
        .bind(body.messageId, gameId, body.messageId, gameId, body.messageId, gameId)
        .first<{ source: (typeof MESSAGE_TABLES)[number] }>();
      if (!message) throw new HttpError(404, 'Message not found.');
      const table = MESSAGE_TABLES.find((candidate) => candidate === message.source) ?? 'chat_messages';
      await db.batch([
        db
          .prepare(`UPDATE ${table} SET body = NULL, deleted_by_moderator_id = ?, deleted_at = ? WHERE id = ?`)
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
      if (!body.roomId || (body.status !== 'OPEN' && body.status !== 'READ_ONLY')) {
        throw new Error('Choose a room and a valid status.');
      }
      const game = await db
        .prepare('SELECT status FROM games WHERE id = ? LIMIT 1')
        .bind(gameId)
        .first<{ status: string }>();
      if (!game) throw new HttpError(404, 'Game not found.');
      if (body.status === 'OPEN' && ['STOPPED', 'COMPLETED', 'CANCELLED'].includes(game.status)) {
        throw new Error('Rooms remain read-only after the game has stopped or completed.');
      }
      const result = await db
        .prepare("UPDATE chat_rooms SET status = ? WHERE id = ? AND game_id = ? AND status != 'PURGED'")
        .bind(body.status, body.roomId, gameId)
        .run();
      if (changes(result) === 0) throw new Error('Room not found or purged.');
      return Response.json({ ok: true });
    }
    if (body.action === 'PURGE_RETENTION') {
      const game = await db
        .prepare('SELECT chat_retention_days AS retentionDays FROM games WHERE id = ?')
        .bind(gameId)
        .first<{ retentionDays: number }>();
      if (!game) throw new HttpError(404, 'Game not found.');
      const cutoff = new Date(Date.now() - Number(game.retentionDays) * 86_400_000).toISOString();
      const result = await db.batch(MESSAGE_TABLES.map((table) => db
        .prepare(
          `UPDATE ${table} SET body = NULL, purged_at = ?
           WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?)
           AND created_at < ? AND purged_at IS NULL AND deleted_at IS NULL`,
        )
        .bind(now, gameId, cutoff)));
      return Response.json({ ok: true, purged: result.reduce((total, item) => total + changes(item), 0), cutoff });
    }
    throw new Error('Unknown room operation.');
  } catch (error) {
    return routeError(error, 'Unable to update private rooms.');
  }
}
