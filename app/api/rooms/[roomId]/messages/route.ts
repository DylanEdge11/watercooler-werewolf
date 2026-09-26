import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { getCurrentPlayer } from '../../../../../lib/auth/session';
import { ensureGameRooms, normalizeChatBody } from '../../../../../lib/chat/rooms';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../../lib/http/rate-limit';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

async function requireRoomAccess(roomId: string) {
  const identity = await getCurrentPlayer();
  if (!identity) throw new HttpError(401, 'Player authentication required.');
  await ensureGameRooms(identity.gameId);
  const room = await getDb()
    .prepare(
      `SELECT cr.id, cr.game_id AS gameId, cr.type, cr.status, crm.access
       FROM chat_rooms cr JOIN chat_room_members crm ON crm.room_id = cr.id
       WHERE cr.id = ? AND crm.seat_id = ? AND crm.access != 'REVOKED' LIMIT 1`,
    )
    .bind(roomId, identity.seatId)
    .first<{ id: string; gameId: string; type: string; status: string; access: string }>();
  if (!room || room.gameId !== identity.gameId) throw new HttpError(403, 'Private room access denied.');
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
    return routeError(error, 'Unable to load this room.');
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
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO chat_messages (id, room_id, author_seat_id, body, created_at)
           SELECT ?, ?, ?, ?, ?
           FROM chat_rooms cr
           JOIN games g ON g.id = cr.game_id
           JOIN chat_room_members crm ON crm.room_id = cr.id AND crm.seat_id = ?
           JOIN seats s ON s.id = crm.seat_id AND s.game_id = cr.game_id
           JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
           WHERE cr.id = ?
             AND cr.status = 'OPEN'
             AND crm.access = 'WRITE'
             AND crm.revoked_at IS NULL
             AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')
             AND s.status = 'CLAIMED'
             AND (
               (cr.type = 'DEAD' AND s.alive = 0)
               OR (cr.type = 'WEREWOLF' AND s.alive = 1 AND ra.role_key = 'WEREWOLF')
               OR (cr.type = 'MASON' AND s.alive = 1 AND ra.role_key = 'MASON')
             )`,
        )
        .bind(id, roomId, identity.seatId, message, now, identity.seatId, roomId),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_seat_id, payload_json, created_at)
           SELECT ?, ?, 'CHAT_MESSAGE_SENT', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM chat_messages
             WHERE id = ? AND room_id = ? AND author_seat_id = ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          identity.gameId,
          identity.seatId,
          JSON.stringify({ roomId, messageId: id }),
          now,
          id,
          roomId,
          identity.seatId,
        ),
    ]);
    if (Number(result[0]?.meta?.changes ?? 0) !== 1) {
      return jsonError('The room or your write access changed before the message could be saved. Refresh and try again.', 409);
    }
    return Response.json({ ok: true, message: { id, body: message, authorName: identity.displayName, createdAt: now } }, { status: 201 });
  } catch (error) {
    return routeError(error, 'Unable to send this message.');
  }
}
