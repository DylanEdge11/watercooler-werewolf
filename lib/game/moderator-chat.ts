/**
 * A moderator can read every private room of their game and post in any of
 * them under the name "Moderator". Players never see which moderator wrote it.
 */
export const MODERATOR_AUTHOR_NAME = 'Moderator';

/** The game statuses in which anyone can post; the same as for players and spectators. */
const POSTING_GAME_STATUSES = ['ACTIVE', 'FINAL_SHOWDOWN'] as const;

/** A moderator posts on the same terms as players: an open room in a running game. Reopen a read-only room to post. */
export function moderatorCanPost(gameStatus: string, roomStatus: string): boolean {
  return roomStatus === 'OPEN' && (POSTING_GAME_STATUSES as readonly string[]).includes(gameStatus);
}

/** Why a moderator can't post right now, for the console. */
export function moderatorPostBlockedReason(gameStatus: string, roomStatus: string): string | null {
  if (moderatorCanPost(gameStatus, roomStatus)) return null;
  if (!(POSTING_GAME_STATUSES as readonly string[]).includes(gameStatus)) return 'Posting is open only while the game is running.';
  return 'This room is read-only. Reopen it to post.';
}

/** The page size of a room's history in the console. */
export const ROOM_HISTORY_PAGE_SIZE = 100;

export interface RoomHistoryCursor {
  createdAt: string;
  id: string;
}

/** Older messages are fetched before a cursor of the oldest message on screen: `<createdAt>~<id>`. */
export function encodeRoomHistoryCursor(cursor: RoomHistoryCursor): string {
  return `${cursor.createdAt}~${cursor.id}`;
}

export function parseRoomHistoryCursor(value: string | null): RoomHistoryCursor | null {
  if (!value) return null;
  const separator = value.lastIndexOf('~');
  if (separator <= 0 || separator === value.length - 1) throw new Error('Invalid message cursor.');
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (Number.isNaN(Date.parse(createdAt)) || id.length > 64) throw new Error('Invalid message cursor.');
  return { createdAt, id };
}
