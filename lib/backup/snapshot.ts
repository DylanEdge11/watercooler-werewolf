import { getD1 } from '../../db';
import { sha256 } from '../auth/crypto';
import { randomToken } from '../auth/crypto';
import { backupComposition, backupGameFromRecord, backupSeats, validateBackupForRestore } from './restore';

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

export interface RestoreGameResult {
  safetyBackupId: string;
  safetyBackupChecksum: string;
  sourceBackupId: string;
  restoredSeatCount: number;
  inviteRows: Array<{ displayName: string; email: string; claimUrl: string; inviteCode: string }>;
}

interface StoredBackupRow {
  id: string;
  gameId: string;
  schemaVersion: number;
  checksum: string;
  payloadJson: string | null;
}

function backupGameId(data: GameBackup): string | null {
  if (!data.game || typeof data.game !== 'object' || Array.isArray(data.game)) return null;
  const id = (data.game as Record<string, unknown>).id;
  return typeof id === 'string' ? id : null;
}

/**
 * Restore a stored backup into the selected game as a clean setup state.
 *
 * Secrets are intentionally not restored: every seat receives a newly
 * generated claim code, PINs are cleared, and all player sessions are
 * invalidated. Active phases, role assignments, chats, notifications, and
 * announcements are removed so the moderator can re-run setup safely. The
 * current state is backed up immediately before the restore and the existing
 * event/operational history remains available for audit.
 */
export async function restoreGameBackup(
  gameId: string,
  sourceBackup: StoredBackupRow,
  moderatorId: string,
  origin: string,
): Promise<RestoreGameResult> {
  if (sourceBackup.gameId !== gameId) throw new Error('The selected backup belongs to a different game.');
  if (!sourceBackup.payloadJson) throw new Error('The selected backup has no recoverable payload.');
  const data = JSON.parse(sourceBackup.payloadJson) as GameBackup;
  const recalculatedChecksum = await sha256(sourceBackup.payloadJson);
  if (recalculatedChecksum !== sourceBackup.checksum) throw new Error('The selected backup checksum does not match its stored payload.');
  const validationErrors = validateBackupForRestore(data, gameId);
  if (validationErrors.length) throw new Error(validationErrors.join(' '));
  if (backupGameId(data) !== gameId) throw new Error('The selected backup belongs to a different game.');
  const backupGame = backupGameFromRecord(data.game as Record<string, unknown>);
  if (!backupGame) throw new Error('The selected backup has invalid game configuration.');

  const db = getD1();
  const safetyBackup = await createBackupRecord(gameId, moderatorId);
  const currentSeats = await db.prepare('SELECT id FROM seats WHERE game_id = ?').bind(gameId).all<{ id: string }>();
  const restoredSeats = backupSeats(data);
  const now = new Date().toISOString();
  const inviteRows = await Promise.all(
    restoredSeats.map(async (seat) => {
      const inviteCode = randomToken(9);
      return {
        ...seat,
        inviteCode,
        claimCodeHash: await sha256(inviteCode),
        claimUrl: `${origin}/claim/${encodeURIComponent(inviteCode)}`,
      };
    }),
  );
  const restoredIds = new Set(restoredSeats.map((seat) => seat.id));
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM action_submissions WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?)').bind(gameId),
    db.prepare('DELETE FROM resolution_proposals WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?)').bind(gameId),
    db.prepare('UPDATE game_events SET phase_id = NULL WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?)').bind(gameId),
    db.prepare('DELETE FROM phases WHERE game_id = ?').bind(gameId),
    db.prepare('DELETE FROM role_assignments WHERE game_id = ?').bind(gameId),
    db.prepare('DELETE FROM assignment_batches WHERE game_id = ?').bind(gameId),
    db.prepare('DELETE FROM game_role_counts WHERE game_id = ?').bind(gameId),
    db.prepare('DELETE FROM notifications WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?)').bind(gameId),
    db.prepare('DELETE FROM announcements WHERE game_id = ?').bind(gameId),
    db.prepare('DELETE FROM chat_room_members WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?)').bind(gameId),
    db.prepare('DELETE FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?)').bind(gameId),
    db.prepare("UPDATE chat_rooms SET status = 'OPEN' WHERE game_id = ?").bind(gameId),
    db.prepare('DELETE FROM seat_sessions WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?)').bind(gameId),
    db.prepare(
      `UPDATE seats SET status = 'REMOVED', pin_hash = NULL, session_version = session_version + 1,
                        alive = 0, predecessor_seat_id = NULL, claimed_at = NULL, updated_at = ?
       WHERE game_id = ?`,
    ).bind(now, gameId),
    db.prepare(
      `UPDATE games SET name = ?, status = 'DRAFT', timezone = ?, start_date = ?, end_date = ?,
                        active_weekdays_json = ?, schedule_json = ?, day_divisor = ?, night_divisor = ?,
                        hunter_window_minutes = ?, final_round_minutes = ?, chat_retention_days = ?,
                        final_cutoff_at = ?, publication_mode = ?, stopped_at = NULL,
                        stopped_by_moderator_id = NULL, stop_reason = NULL, reset_at = ?,
                        reset_by_moderator_id = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      backupGame.name,
      backupGame.timezone,
      backupGame.startDate,
      backupGame.endDate,
      backupGame.activeWeekdaysJson,
      backupGame.scheduleJson,
      backupGame.dayDivisor,
      backupGame.nightDivisor,
      backupGame.hunterWindowMinutes,
      backupGame.finalRoundMinutes,
      backupGame.chatRetentionDays,
      backupGame.finalCutoffAt,
      backupGame.publicationMode,
      now,
      moderatorId,
      now,
      gameId,
    ),
  ];
  for (const seat of currentSeats.results) {
    if (restoredIds.has(seat.id)) continue;
    // Old seat links are invalidated even when the source backup has a smaller roster.
    statements.push(
      db.prepare('UPDATE seats SET claim_code_hash = ?, updated_at = ? WHERE id = ? AND game_id = ?').bind(await sha256(randomToken(18)), now, seat.id, gameId),
    );
  }
  for (const seat of inviteRows) {
    statements.push(
      db.prepare(
        `INSERT INTO seats
         (id, game_id, display_name, email, status, claim_code_hash, pin_hash, session_version,
          alive, predecessor_seat_id, claimed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'INVITED', ?, NULL, 1, 1, NULL, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET game_id = excluded.game_id, display_name = excluded.display_name,
           email = excluded.email, status = 'INVITED', claim_code_hash = excluded.claim_code_hash,
           pin_hash = NULL, session_version = seats.session_version + 1, alive = 1,
           predecessor_seat_id = NULL, claimed_at = NULL, updated_at = excluded.updated_at`,
      ).bind(seat.id, gameId, seat.displayName, seat.email, seat.claimCodeHash, seat.createdAt, now),
    );
  }
  for (const composition of backupComposition(data)) {
    statements.push(
      db.prepare(
        `INSERT INTO game_role_counts (game_id, role_key, count, power_snapshot)
         VALUES (?, ?, ?, ?)`,
      ).bind(gameId, composition.roleKey, composition.count, composition.powerSnapshot),
    );
  }
  statements.push(
    db.prepare(
      `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
       VALUES (?, ?, 'GAME_RESTORED', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      gameId,
      moderatorId,
      JSON.stringify({ sourceBackupId: sourceBackup.id, sourceChecksum: sourceBackup.checksum, safetyBackupId: safetyBackup.backupId, status: 'DRAFT', restoredSeatCount: inviteRows.length }),
      now,
    ),
    db.prepare(
      `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
       VALUES (?, ?, 'WARNING', 'GAME_CONTROL', 'A stored backup was restored to setup state.', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      gameId,
      JSON.stringify({ moderatorId, sourceBackupId: sourceBackup.id, sourceChecksum: sourceBackup.checksum, safetyBackupId: safetyBackup.backupId, restoredSeatCount: inviteRows.length }),
      now,
    ),
  );
  await db.batch(statements);
  return {
    safetyBackupId: safetyBackup.backupId,
    safetyBackupChecksum: safetyBackup.checksum,
    sourceBackupId: sourceBackup.id,
    restoredSeatCount: inviteRows.length,
    inviteRows: inviteRows.map(({ displayName, email, claimUrl, inviteCode }) => ({ displayName, email, claimUrl, inviteCode })),
  };
}
