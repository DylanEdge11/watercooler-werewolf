import { getD1 } from '../../db';
import { sha256 } from '../auth/crypto';

export interface GameBackup {
  schemaVersion: 2;
  exportedAt: string;
  game: unknown;
  moderators: unknown[];
  seats: unknown[];
  composition: unknown[];
  assignmentBatches: unknown[];
  roleAssignments: unknown[];
  phases: unknown[];
  actionSubmissions: unknown[];
  resolutionProposals: unknown[];
  gameEvents: unknown[];
  chatRooms: unknown[];
  chatRoomMembers: unknown[];
  chatMessages: unknown[];
  announcements: unknown[];
  notifications: unknown[];
  operationalEvents: unknown[];
  pilotFeedback: unknown[];
}

export async function collectGameBackup(gameId: string): Promise<GameBackup> {
  const db = getD1();
  const [game, moderators, seats, composition, batches, assignments, phases, actions, resolutions, events, rooms, roomMembers, messages, announcements, notifications, operations, feedback] = await Promise.all([
    db.prepare('SELECT * FROM games WHERE id = ? LIMIT 1').bind(gameId).first(),
    db
      .prepare(
        `SELECT ma.id, ma.email, gm.role, gm.added_at AS addedAt
         FROM game_moderators gm JOIN moderator_accounts ma ON ma.id = gm.moderator_id
         WHERE gm.game_id = ?`,
      )
      .bind(gameId).all(),
    db
      .prepare(
        `SELECT id, game_id AS gameId, display_name AS displayName, email, status,
                session_version AS sessionVersion, alive, predecessor_seat_id AS predecessorSeatId,
                claimed_at AS claimedAt, created_at AS createdAt, updated_at AS updatedAt
         FROM seats WHERE game_id = ?`,
      )
      .bind(gameId).all(),
    db.prepare('SELECT * FROM game_role_counts WHERE game_id = ?').bind(gameId).all(),
    db.prepare('SELECT * FROM assignment_batches WHERE game_id = ?').bind(gameId).all(),
    db.prepare('SELECT * FROM role_assignments WHERE game_id = ?').bind(gameId).all(),
    db.prepare('SELECT * FROM phases WHERE game_id = ?').bind(gameId).all(),
    db
      .prepare(
        `SELECT a.* FROM action_submissions a JOIN phases p ON p.id = a.phase_id
         WHERE p.game_id = ?`,
      )
      .bind(gameId).all(),
    db
      .prepare(
        `SELECT r.* FROM resolution_proposals r JOIN phases p ON p.id = r.phase_id
         WHERE p.game_id = ?`,
      )
      .bind(gameId).all(),
    db.prepare('SELECT * FROM game_events WHERE game_id = ? ORDER BY created_at').bind(gameId).all(),
    db.prepare('SELECT * FROM chat_rooms WHERE game_id = ?').bind(gameId).all(),
    db
      .prepare(
        `SELECT m.* FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id
         WHERE r.game_id = ?`,
      )
      .bind(gameId).all(),
    db
      .prepare(
        `SELECT m.* FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id
         WHERE r.game_id = ? ORDER BY m.created_at`,
      )
      .bind(gameId).all(),
    db.prepare('SELECT * FROM announcements WHERE game_id = ? ORDER BY created_at').bind(gameId).all(),
    db
      .prepare(
        `SELECT n.* FROM notifications n JOIN seats s ON s.id = n.seat_id
         WHERE s.game_id = ? ORDER BY n.created_at`,
      )
      .bind(gameId).all(),
    db.prepare('SELECT * FROM operational_events WHERE game_id = ? ORDER BY created_at').bind(gameId).all(),
    db.prepare('SELECT * FROM pilot_feedback WHERE game_id = ? ORDER BY created_at').bind(gameId).all(),
  ]);
  if (!game) throw new Error('Game not found.');
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    game,
    moderators: moderators.results,
    seats: seats.results,
    composition: composition.results,
    assignmentBatches: batches.results,
    roleAssignments: assignments.results,
    phases: phases.results,
    actionSubmissions: actions.results,
    resolutionProposals: resolutions.results,
    gameEvents: events.results,
    chatRooms: rooms.results,
    chatRoomMembers: roomMembers.results,
    chatMessages: messages.results,
    announcements: announcements.results,
    notifications: notifications.results,
    operationalEvents: operations.results,
    pilotFeedback: feedback.results,
  };
}

export async function createBackupRecord(gameId: string, moderatorId: string): Promise<{ backupId: string; data: GameBackup; checksum: string }> {
  const data = await collectGameBackup(gameId);
  const checksum = await sha256(JSON.stringify(data));
  const backupId = crypto.randomUUID();
  await getD1()
    .prepare(
      `INSERT INTO backup_exports (id, game_id, moderator_id, schema_version, checksum, payload_json, exported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(backupId, gameId, moderatorId, data.schemaVersion, checksum, JSON.stringify(data), data.exportedAt)
    .run();
  return { backupId, data, checksum };
}
