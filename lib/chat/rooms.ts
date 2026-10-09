import { getDb, type PreparedStatement } from '../../db';
import type { Database } from '../../db/contracts';
import type { PrivateRoomType } from './policy';

export { normalizeChatBody } from './policy';

const ROOM_TYPES: PrivateRoomType[] = ['WEREWOLF', 'MASON', 'DEAD', 'TOWN_HALL'];
/** A game with fewer rooms than this is missing some and gets them repaired. */
export const ROOM_TYPE_COUNT = ROOM_TYPES.length;

/**
 * Creates the game's rooms and brings every membership in line with
 * `allowedRoomTypes`: every player in the Town Hall, Werewolves and Masons in
 * their room (both read-only once eliminated), and every eliminated player in
 * the Afterlife. The SQL mirrors that function, and `room-sync.test.ts` checks
 * the two agree. Membership changes only when roles are released or a phase is
 * published, so those writes add these statements to their own transaction;
 * reads never write. A late Villager's claim adds `townHallJoinStatement`.
 */
export function roomSyncStatements(db: Database, gameId: string, now: string): PreparedStatement[] {
  return [
    ...ROOM_TYPES.map((type) =>
      db
        .prepare("INSERT OR IGNORE INTO chat_rooms (id, game_id, type, status, created_at) VALUES (?, ?, ?, 'OPEN', ?)")
        .bind(crypto.randomUUID(), gameId, type, now),
    ),
    db
      .prepare(
        `INSERT INTO chat_room_members (room_id, seat_id, access, granted_at, revoked_at)
         SELECT r.id, s.id,
                CASE WHEN r.type = 'DEAD' OR s.alive = 1 THEN 'WRITE' ELSE 'READ_ONLY' END,
                ?,
                CASE WHEN r.type = 'DEAD' OR s.alive = 1 THEN NULL ELSE ? END
         FROM seats s
         JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
         JOIN chat_rooms r ON r.game_id = s.game_id
         WHERE s.game_id = ? AND s.status = 'CLAIMED'
           AND (r.type = 'TOWN_HALL'
             OR (r.type = 'WEREWOLF' AND ra.role_key = 'WEREWOLF')
             OR (r.type = 'MASON' AND ra.role_key = 'MASON')
             OR (r.type = 'DEAD' AND s.alive = 0))
         ON CONFLICT(room_id, seat_id) DO UPDATE SET access = excluded.access, revoked_at = excluded.revoked_at
         WHERE chat_room_members.access != excluded.access`,
      )
      .bind(now, now, gameId),
  ];
}

/**
 * A seat claimed after roles were released (a late Villager) joins the Town
 * Hall in its claim transaction instead of waiting for the next publish.
 * Before release there is no Town Hall yet, so this changes nothing.
 */
export function townHallJoinStatement(db: Database, seatId: string, now: string): PreparedStatement {
  return db
    .prepare(
      `INSERT INTO chat_room_members (room_id, seat_id, access, granted_at, revoked_at)
       SELECT r.id, s.id, 'WRITE', ?, NULL
       FROM seats s
       JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
       JOIN chat_rooms r ON r.game_id = s.game_id AND r.type = 'TOWN_HALL'
       WHERE s.id = ? AND s.status = 'CLAIMED' AND s.alive = 1
       ON CONFLICT(room_id, seat_id) DO NOTHING`,
    )
    .bind(now, seatId);
}

/** Runs the room sync on its own. Release and publish include it in their transaction instead. */
export async function ensureGameRooms(gameId: string): Promise<void> {
  const db = getDb();
  await db.batch(roomSyncStatements(db, gameId, new Date().toISOString()));
}

/**
 * A one-read safety net for games whose rooms were never created (for
 * example, a release that failed before this sync moved into its
 * transaction, or a game started before the Town Hall existed). Creates them
 * only when fewer than four exist.
 */
export async function ensureGameRoomsExist(gameId: string): Promise<void> {
  const row = await getDb().prepare('SELECT COUNT(*) AS count FROM chat_rooms WHERE game_id = ?').bind(gameId).first<{ count: number }>();
  if (Number(row?.count ?? 0) < ROOM_TYPES.length) await ensureGameRooms(gameId);
}
