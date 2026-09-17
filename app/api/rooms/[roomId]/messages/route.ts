import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { getCurrentPlayer } from '../../../../../lib/auth/session';
import { ensureGameRooms, normalizeChatBody } from '../../../../../lib/chat/rooms';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../../lib/http/rate-limit';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

async function requireRoomAccess(roomId: string) {
  const identity = await getCurrentPlayer();
  if (!identity) throw new Error('Player authentication required.');
  await ensureGameRooms(identity.gameId);
  const room = await getDb()
    .prepare(
      `SELECT cr.id, cr.game_id AS gameId, cr.type, cr.status, crm.access
       FROM chat_rooms cr JOIN chat_room_members crm ON crm.room_id = cr.id
       WHERE cr.id = ? AND crm.seat_id = ? AND crm.access != 'REVOKED' LIMIT 1`,
    )
    .bind(roomId, identity.seatId)
    .first<{ id: string; gameId: string; type: string; status: string; access: string }>();
  if (!room || room.gameId !== identity.gameId) throw new Error('Private room access denied.');
  return { identity, room };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { roomId } = await context.params;
    const { room } = await requireRoomAccess(roomId);
    const messages = await getDb()
      .prepare(
        `SELECT * FROM (
           SELECT cm.id, cm.author_seat_id AS authorSeatId, s.display_name AS authorName,
                  cm.body, cm.deleted_at AS deletedAt, cm.purged_at AS purgedAt, cm.created_at AS createdAt
           FROM chat_messages cm JOIN seats s ON s.id = cm.author_seat_id
           WHERE cm.room_id = ? ORDER BY cm.created_at DESC LIMIT 100
         ) recent ORDER BY createdAt ASC`,
      )
      .bind(roomId)
      .all();
    return Response.json({ ok: true, room, messages: messages.results });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load this room.', 403);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { roomId } = await context.params;
    const { identity, room } = await requireRoomAccess(roomId);
    if (room.status !== 'OPEN' || room.access !== 'WRITE') throw new Error('This room is read-only.');
    await enforceRateLimit(requestRateLimitKey(request, `chat:${identity.seatId}:${roomId}`), 30, 10 * 60_000);
    const body = (await request.json()) as { body?: string };
    const message = normalizeChatBody(body.body ?? '');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    await db.batch([
      db
        .prepare(
          `INSERT INTO chat_messages (id, room_id, author_seat_id, body, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, roomId, identity.seatId, message, now),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_seat_id, payload_json, created_at)
           VALUES (?, ?, 'CHAT_MESSAGE_SENT', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), identity.gameId, identity.seatId, JSON.stringify({ roomId, messageId: id }), now),
    ]);
    return Response.json({ ok: true, message: { id, body: message, authorName: identity.displayName, createdAt: now } }, { status: 201 });
  } catch (error) {
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to send this message.', 400);
  }
}
