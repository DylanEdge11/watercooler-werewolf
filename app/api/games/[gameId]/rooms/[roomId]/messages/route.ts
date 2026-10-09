import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { normalizeChatBody } from '@/lib/chat/rooms';
import { loadRoomMessages } from '@/lib/chat/room-messages';
import {
  MODERATOR_AUTHOR_NAME,
  ROOM_HISTORY_PAGE_SIZE,
  encodeRoomHistoryCursor,
  moderatorPostBlockedReason,
  parseRoomHistoryCursor,
} from '@/lib/game/moderator-chat';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { HttpError, routeError } from '@/lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '@/lib/http/rate-limit';
import { respondJsonWithEtag } from '@/lib/http/etag';
import { changes } from '@/db/results';
import type { RouteContext } from '@/lib/http/route-context';

interface ModeratorRoom {
  id: string;
  type: string;
  status: string;
  gameStatus: string;
}

async function loadRoom(gameId: string, roomId: string): Promise<ModeratorRoom> {
  const room = await getDb()
    .prepare(
      `SELECT cr.id, cr.type, cr.status, g.status AS gameStatus
       FROM chat_rooms cr JOIN games g ON g.id = cr.game_id
       WHERE cr.id = ? AND cr.game_id = ? LIMIT 1`,
    )
    .bind(roomId, gameId)
    .first<ModeratorRoom>();
  if (!room) throw new HttpError(404, 'Room not found.');
  return room;
}

/** A room's full history for the game's moderators, one page at a time: the newest page, or the page before `?before=`. */
export async function GET(request: Request, context: RouteContext<{ gameId: string; roomId: string }>) {
  try {
    await ensureDatabase();
    const { gameId, roomId } = await context.params;
    await requireGameModerator(gameId);
    const before = parseRoomHistoryCursor(new URL(request.url).searchParams.get('before'));
    const room = await loadRoom(gameId, roomId);
    const { messages, hasEarlier } = await loadRoomMessages(getDb(), roomId, { limit: ROOM_HISTORY_PAGE_SIZE, before });
    const oldest = messages[0];
    return respondJsonWithEtag(request, {
      ok: true,
      room: { id: room.id, type: room.type, status: room.status, postBlockedReason: moderatorPostBlockedReason(room.gameStatus, room.status) },
      messages,
      earlierCursor: hasEarlier && oldest ? encodeRoomHistoryCursor(oldest) : null,
    });
  } catch (error) {
    return routeError(error, 'Unable to load this room.');
  }
}

/** A moderator posts in any of the game's rooms, shown to its members as "Moderator". */
export async function POST(request: Request, context: RouteContext<{ gameId: string; roomId: string }>) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId, roomId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const room = await loadRoom(gameId, roomId);
    const blocked = moderatorPostBlockedReason(room.gameStatus, room.status);
    if (blocked) throw new HttpError(409, blocked);
    await enforceRateLimit(requestRateLimitKey(request, `chat:moderator:${moderator.id}:${roomId}`), 30, 10 * 60_000);
    const body = (await request.json()) as { body?: string };
    const message = normalizeChatBody(typeof body.body === 'string' ? body.body : '');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    // Re-check the room and game inside the write: a Stop or a read-only switch may land in between.
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO moderator_messages (id, room_id, moderator_id, body, created_at)
           SELECT ?, cr.id, ?, ?, ?
           FROM chat_rooms cr JOIN games g ON g.id = cr.game_id
           WHERE cr.id = ? AND cr.game_id = ? AND cr.status = 'OPEN'
             AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')`,
        )
        .bind(id, moderator.id, message, now, roomId, gameId),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'MODERATOR_CHAT_MESSAGE_SENT', ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM moderator_messages WHERE id = ? AND room_id = ?)`,
        )
        .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ roomId, messageId: id }), now, id, roomId),
    ]);
    if (changes(result[0]) !== 1) {
      return jsonError('The room or the game changed before the message could be saved. Refresh and try again.', 409);
    }
    return Response.json(
      { ok: true, message: { id, authorSeatId: null, authorName: MODERATOR_AUTHOR_NAME, authorKind: 'MODERATOR', body: message, deletedAt: null, purgedAt: null, createdAt: now } },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error, 'Unable to send this message.');
  }
}
