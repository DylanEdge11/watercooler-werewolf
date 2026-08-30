import { getD1 } from '../../db';
import { canonicalRoleKey, type RoleKey } from '../game/types';
import { allowedRoomTypes, type PrivateRoomType } from './policy';

export { allowedRoomTypes, normalizeChatBody } from './policy';

export async function ensureGameRooms(gameId: string): Promise<void> {
  const db = getD1();
  const now = new Date().toISOString();
  for (const type of ['WEREWOLF', 'MASON', 'DEAD'] as PrivateRoomType[]) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO chat_rooms (id, game_id, type, status, created_at)
         VALUES (?, ?, ?, 'OPEN', ?)`,
      )
      .bind(crypto.randomUUID(), gameId, type, now)
      .run();
  }
  const rooms = await db
    .prepare('SELECT id, type FROM chat_rooms WHERE game_id = ?')
    .bind(gameId)
    .all<{ id: string; type: PrivateRoomType }>();
  const roomByType = new Map(rooms.results.map((room) => [room.type, room.id]));
  const seats = await db
    .prepare(
      `SELECT s.id, s.alive, ra.role_key AS role
       FROM seats s JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
       WHERE s.game_id = ? AND s.status = 'CLAIMED'`,
    )
    .bind(gameId)
    .all<{ id: string; alive: number; role: RoleKey }>();

  const statements: D1PreparedStatement[] = [];
  for (const seat of seats.results) {
    const alive = Boolean(seat.alive);
    const role = canonicalRoleKey(seat.role);
    for (const type of allowedRoomTypes(role, alive)) {
      const roomId = roomByType.get(type);
      if (!roomId) continue;
      statements.push(
        db
          .prepare(
            `INSERT INTO chat_room_members (room_id, seat_id, access, granted_at)
             VALUES (?, ?, 'WRITE', ?)
             ON CONFLICT(room_id, seat_id) DO UPDATE SET access = 'WRITE', revoked_at = NULL`,
          )
          .bind(roomId, seat.id, now),
      );
    }
    if (!alive && (role === 'WEREWOLF' || role === 'MASON')) {
      const formerRoomId = roomByType.get(role);
      if (formerRoomId) {
        statements.push(
          db
            .prepare(
              `UPDATE chat_room_members SET access = 'READ_ONLY', revoked_at = ?
               WHERE room_id = ? AND seat_id = ?`,
            )
            .bind(now, formerRoomId, seat.id),
        );
      }
    }
  }
  if (statements.length) await db.batch(statements);
}
