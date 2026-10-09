import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { getCurrentPlayer, getCurrentSpectator, type PlayerIdentity, type SpectatorIdentity } from '../../../../../lib/auth/session';
import { normalizeChatBody } from '../../../../../lib/chat/rooms';
import { loadRoomMessages } from '../../../../../lib/chat/room-messages';
import { spectatorAuthorName } from '../../../../../lib/game/spectators';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../../lib/http/rate-limit';
import { respondJsonWithEtag } from '../../../../../lib/http/etag';
import { changes } from '../../../../../db/results';

interface RouteContext {
  params: Promise<{ roomId: string }>;
}

interface RoomAccess {
  id: string;
  gameId: string;
  type: string;
  status: string;
  access: string;
}

type RoomViewer =
  | { kind: 'PLAYER'; identity: PlayerIdentity; room: RoomAccess }
  | { kind: 'SPECTATOR'; identity: SpectatorIdentity; room: RoomAccess };

/**
 * A player reaches the rooms they are a member of. A spectator reaches their
 * game's Afterlife, and reads (never posts in) its Town Hall.
 */
async function requireRoomAccess(roomId: string): Promise<RoomViewer> {
  const identity = await getCurrentPlayer();
  if (identity) {
    const room = await getDb()
      .prepare(
        `SELECT cr.id, cr.game_id AS gameId, cr.type, cr.status, crm.access
         FROM chat_rooms cr JOIN chat_room_members crm ON crm.room_id = cr.id
         WHERE cr.id = ? AND crm.seat_id = ? AND crm.access != 'REVOKED' LIMIT 1`,
      )
      .bind(roomId, identity.seatId)
      .first<RoomAccess>();
    if (!room || room.gameId !== identity.gameId) throw new HttpError(403, 'Private room access denied.');
    return { kind: 'PLAYER', identity, room };
  }
  const spectator = await getCurrentSpectator();
  if (!spectator) throw new HttpError(401, 'Player authentication required.');
  const room = await getDb()
    .prepare(
      `SELECT id, game_id AS gameId, type, status, CASE WHEN type = 'DEAD' THEN 'WRITE' ELSE 'READ_ONLY' END AS access
       FROM chat_rooms WHERE id = ? AND game_id = ? AND type IN ('DEAD', 'TOWN_HALL') LIMIT 1`,
    )
    .bind(roomId, spectator.gameId)
    .first<RoomAccess>();
  if (!room) throw new HttpError(403, 'Private room access denied.');
  return { kind: 'SPECTATOR', identity: spectator, room };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { roomId } = await context.params;
    const { room } = await requireRoomAccess(roomId);
    // Spectator and moderator messages are kept in their own tables and labelled; a moderator shows as "Moderator".
    const { messages } = await loadRoomMessages(getDb(), roomId, { limit: 100 });
    return respondJsonWithEtag(request, {
      ok: true,
      room,
      messages: messages.map(({ authorKind, ...message }) => ({ ...message, byModerator: authorKind === 'MODERATOR' })),
    });
  } catch (error) {
    return routeError(error, 'Unable to load this room.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { roomId } = await context.params;
    const viewer = await requireRoomAccess(roomId);
    const { room } = viewer;
    if (room.status !== 'OPEN' || room.access !== 'WRITE') throw new Error('This room is read-only.');
    const authorId = viewer.kind === 'PLAYER' ? viewer.identity.seatId : viewer.identity.spectatorId;
    await enforceRateLimit(requestRateLimitKey(request, `chat:${authorId}:${roomId}`), 30, 10 * 60_000);
    const body = (await request.json()) as { body?: string };
    const message = normalizeChatBody(body.body ?? '');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    if (viewer.kind === 'SPECTATOR') {
      const result = await db.batch([
        db
          .prepare(
            `INSERT INTO spectator_messages (id, room_id, spectator_id, body, created_at)
             SELECT ?, ?, ?, ?, ?
             FROM chat_rooms cr
             JOIN games g ON g.id = cr.game_id
             JOIN spectators sp ON sp.id = ? AND sp.game_id = cr.game_id
             WHERE cr.id = ? AND cr.type = 'DEAD' AND cr.status = 'OPEN'
               AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')
               AND sp.status = 'ACTIVE'`,
          )
          .bind(id, roomId, authorId, message, now, authorId, roomId),
        db
          .prepare(
            `INSERT INTO game_events (id, game_id, event_type, payload_json, created_at)
             SELECT ?, ?, 'SPECTATOR_CHAT_MESSAGE_SENT', ?, ?
             WHERE EXISTS (SELECT 1 FROM spectator_messages WHERE id = ? AND room_id = ? AND spectator_id = ?)`,
          )
          .bind(crypto.randomUUID(), room.gameId, JSON.stringify({ roomId, messageId: id, spectatorId: authorId }), now, id, roomId, authorId),
      ]);
      if (changes(result[0]) !== 1) {
        return jsonError('The Afterlife or your spectator access changed before the message could be saved. Refresh and try again.', 409);
      }
      return Response.json({ ok: true, message: { id, body: message, authorName: spectatorAuthorName(viewer.identity.displayName), createdAt: now } }, { status: 201 });
    }
    const identity = viewer.identity;
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
               (cr.type = 'TOWN_HALL' AND s.alive = 1)
               OR (cr.type = 'DEAD' AND s.alive = 0)
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
    if (changes(result[0]) !== 1) {
      return jsonError('The room or your write access changed before the message could be saved. Refresh and try again.', 409);
    }
    return Response.json({ ok: true, message: { id, body: message, authorName: identity.displayName, createdAt: now } }, { status: 201 });
  } catch (error) {
    return routeError(error, 'Unable to send this message.');
  }
}
