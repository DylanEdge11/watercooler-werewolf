import type { Database } from '../../db/contracts';
import { MODERATOR_AUTHOR_NAME, type RoomHistoryCursor } from '../game/moderator-chat';
import { spectatorAuthorName } from '../game/spectators';

/** Who wrote a room message: a seated player, a spectator (Afterlife only), or a moderator. */
export type RoomMessageAuthor = 'PLAYER' | 'SPECTATOR' | 'MODERATOR';

export interface RoomMessage {
  id: string;
  authorSeatId: string | null;
  authorName: string;
  authorKind: RoomMessageAuthor;
  body: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  createdAt: string;
}

/** The three message tables of one room as one list. A moderator's own name or email is never selected. */
const ROOM_MESSAGES_UNION = `
  SELECT cm.id, cm.author_seat_id AS authorSeatId, s.display_name AS authorName, 'PLAYER' AS authorKind,
         cm.body, cm.deleted_at AS deletedAt, cm.purged_at AS purgedAt, cm.created_at AS createdAt
  FROM chat_messages cm JOIN seats s ON s.id = cm.author_seat_id
  WHERE cm.room_id = ?
  UNION ALL
  SELECT sm.id, NULL, sp.display_name, 'SPECTATOR',
         sm.body, sm.deleted_at, sm.purged_at, sm.created_at
  FROM spectator_messages sm JOIN spectators sp ON sp.id = sm.spectator_id
  WHERE sm.room_id = ?
  UNION ALL
  SELECT mm.id, NULL, NULL, 'MODERATOR',
         mm.body, mm.deleted_at, mm.purged_at, mm.created_at
  FROM moderator_messages mm
  WHERE mm.room_id = ?`;

/** How each kind of author is shown to everyone who reads the room. */
export function roomMessageAuthorName(kind: RoomMessageAuthor, displayName: string | null): string {
  if (kind === 'MODERATOR') return MODERATOR_AUTHOR_NAME;
  if (kind === 'SPECTATOR') return spectatorAuthorName(displayName ?? '');
  return displayName ?? '';
}

/**
 * The newest `limit` messages of a room, oldest first. With `before`, the
 * newest `limit` messages older than that one, for loading earlier history.
 * Fetches one extra row to tell whether anything older remains.
 */
export async function loadRoomMessages(
  db: Database,
  roomId: string,
  options: { limit: number; before?: RoomHistoryCursor | null },
): Promise<{ messages: RoomMessage[]; hasEarlier: boolean }> {
  const before = options.before ?? null;
  const rows = await db
    .prepare(
      `SELECT * FROM (${ROOM_MESSAGES_UNION}) room_messages
       ${before ? 'WHERE createdAt < ? OR (createdAt = ? AND id < ?)' : ''}
       ORDER BY createdAt DESC, id DESC LIMIT ?`,
    )
    .bind(roomId, roomId, roomId, ...(before ? [before.createdAt, before.createdAt, before.id] : []), options.limit + 1)
    .all<Omit<RoomMessage, 'authorName'> & { authorName: string | null }>();
  const page = rows.results.slice(0, options.limit).reverse();
  return {
    hasEarlier: rows.results.length > options.limit,
    messages: page.map((row) => ({ ...row, authorName: roomMessageAuthorName(row.authorKind, row.authorName) })),
  };
}
