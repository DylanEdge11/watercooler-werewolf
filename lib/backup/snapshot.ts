import { getDb, type PreparedStatement } from '../../db';
import { sha256 } from '../auth/crypto';
import { randomToken } from '../auth/crypto';
import { backupComposition, backupGameFromRecord, backupSeats, validateBackupForRestore } from './restore';
import { HttpError } from '../http/errors';

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
  const db = getDb();
  // One read-only transaction, so a write that lands during the backup can't
  // leave it disagreeing with itself (for example, an action without its phase).
  const reads = await db.batch([
    db.prepare('SELECT * FROM games WHERE id = ? LIMIT 1').bind(gameId),
    db
      .prepare(
        `SELECT ma.id, ma.email, gm.role, gm.added_at AS addedAt
         FROM game_moderators gm JOIN moderator_accounts ma ON ma.id = gm.moderator_id
         WHERE gm.game_id = ?`,
      )
      .bind(gameId),
    db
      .prepare(
        `SELECT id, game_id AS gameId, display_name AS displayName, email, status,
                session_version AS sessionVersion, alive, predecessor_seat_id AS predecessorSeatId,
                claimed_at AS claimedAt, created_at AS createdAt, updated_at AS updatedAt
         FROM seats WHERE game_id = ?`,
      )
      .bind(gameId),
    db.prepare('SELECT * FROM game_role_counts WHERE game_id = ?').bind(gameId),
    db.prepare('SELECT * FROM assignment_batches WHERE game_id = ?').bind(gameId),
    db.prepare('SELECT * FROM role_assignments WHERE game_id = ?').bind(gameId),
    db.prepare('SELECT * FROM phases WHERE game_id = ?').bind(gameId),
    db
      .prepare(
        `SELECT a.* FROM action_submissions a JOIN phases p ON p.id = a.phase_id
         WHERE p.game_id = ?`,
      )
      .bind(gameId),
    db
      .prepare(
        `SELECT r.* FROM resolution_proposals r JOIN phases p ON p.id = r.phase_id
         WHERE p.game_id = ?`,
      )
      .bind(gameId),
    db.prepare('SELECT * FROM game_events WHERE game_id = ? ORDER BY created_at').bind(gameId),
    db.prepare('SELECT * FROM chat_rooms WHERE game_id = ?').bind(gameId),
    db
      .prepare(
        `SELECT m.* FROM chat_room_members m JOIN chat_rooms r ON r.id = m.room_id
         WHERE r.game_id = ?`,
      )
      .bind(gameId),
    db
      .prepare(
        `SELECT m.* FROM chat_messages m JOIN chat_rooms r ON r.id = m.room_id
         WHERE r.game_id = ? ORDER BY m.created_at`,
      )
      .bind(gameId),
    db.prepare('SELECT * FROM announcements WHERE game_id = ? ORDER BY created_at').bind(gameId),
    db
      .prepare(
        `SELECT n.* FROM notifications n JOIN seats s ON s.id = n.seat_id
         WHERE s.game_id = ? ORDER BY n.created_at`,
      )
      .bind(gameId),
    db.prepare('SELECT * FROM operational_events WHERE game_id = ? ORDER BY created_at').bind(gameId),
    db.prepare('SELECT * FROM pilot_feedback WHERE game_id = ? ORDER BY created_at').bind(gameId),
  ], 'read');
  const [gameRows, moderators, seats, composition, batches, assignments, phases, actions, resolutions, events, rooms, roomMembers, messages, announcements, notifications, operations, feedback] = reads;
  const game = gameRows.results[0];
  if (!game) throw new HttpError(404, 'Game not found.');
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
  const payloadJson = JSON.stringify(data);
  const checksum = await sha256(payloadJson);
  const backupId = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO backup_exports (id, game_id, moderator_id, schema_version, checksum, payload_json, exported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(backupId, gameId, moderatorId, data.schemaVersion, checksum, payloadJson, data.exportedAt)
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

  const db = getDb();
  const safetyBackup = await createBackupRecord(gameId, moderatorId);
  const currentGame = await db
    .prepare('SELECT status, updated_at AS updatedAt FROM games WHERE id = ? LIMIT 1')
    .bind(gameId)
    .first<{ status: string; updatedAt: string }>();
  if (!currentGame) throw new Error('Game not found while preparing restore.');
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
  const restoreGuard = "EXISTS (SELECT 1 FROM games g WHERE g.id = ? AND g.status = 'RESTORING' AND g.reset_at = ? AND g.reset_by_moderator_id = ?)";
  const statements: PreparedStatement[] = [
    db
      .prepare("UPDATE games SET status = 'RESTORING', setup_revision = setup_revision + 1, reset_at = ?, reset_by_moderator_id = ?, updated_at = ? WHERE id = ? AND status = ? AND updated_at = ?")
      .bind(now, moderatorId, now, gameId, currentGame.status, currentGame.updatedAt),
    db.prepare('DELETE FROM action_submissions WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?) AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM resolution_proposals WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?) AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('UPDATE game_events SET phase_id = NULL WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?) AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM phases WHERE game_id = ? AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM role_assignments WHERE game_id = ? AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM assignment_batches WHERE game_id = ? AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM game_role_counts WHERE game_id = ? AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM notifications WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?) AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM announcements WHERE game_id = ? AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM chat_room_members WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?) AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?) AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare("UPDATE chat_rooms SET status = 'OPEN' WHERE game_id = ? AND " + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare('DELETE FROM seat_sessions WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?) AND ' + restoreGuard).bind(gameId, gameId, now, moderatorId),
    db.prepare("UPDATE seats SET status = 'REMOVED', email = 'archived+' || id || '@invalid.test', pin_hash = NULL, session_version = session_version + 1, alive = 0, predecessor_seat_id = NULL, claimed_at = NULL, updated_at = ? WHERE game_id = ? AND " + restoreGuard).bind(now, gameId, gameId, now, moderatorId),
    db.prepare(
      "UPDATE games SET name = ?, timezone = ?, start_date = ?, end_date = ?, active_weekdays_json = ?, schedule_json = ?, day_divisor = ?, night_divisor = ?, hunter_window_minutes = ?, final_round_minutes = ?, chat_retention_days = ?, final_cutoff_at = ?, publication_mode = ?, automation_paused_at = NULL, stopped_at = NULL, stopped_by_moderator_id = NULL, stop_reason = NULL, updated_at = ? WHERE id = ? AND status = 'RESTORING' AND reset_at = ? AND reset_by_moderator_id = ?",
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
      gameId,
      now,
      moderatorId,
    ),
  ];
  for (const seat of currentSeats.results) {
    if (restoredIds.has(seat.id)) continue;
    // Old seat links are invalidated even when the source backup has a smaller roster.
    statements.push(
      db.prepare('UPDATE seats SET claim_code_hash = ?, updated_at = ? WHERE id = ? AND game_id = ? AND ' + restoreGuard).bind(await sha256(randomToken(18)), now, seat.id, gameId, gameId, now, moderatorId),
    );
  }
  for (const seat of inviteRows) {
    statements.push(
      db.prepare(
        "INSERT INTO seats (id, game_id, display_name, email, status, claim_code_hash, pin_hash, session_version, alive, predecessor_seat_id, claimed_at, created_at, updated_at) SELECT ?, ?, ?, ?, 'INVITED', ?, NULL, 1, 1, NULL, NULL, ?, ? WHERE " + restoreGuard + " ON CONFLICT(id) DO UPDATE SET game_id = excluded.game_id, display_name = excluded.display_name, email = excluded.email, status = 'INVITED', claim_code_hash = excluded.claim_code_hash, pin_hash = NULL, session_version = seats.session_version + 1, alive = 1, predecessor_seat_id = NULL, claimed_at = NULL, updated_at = excluded.updated_at",
      ).bind(seat.id, gameId, seat.displayName, seat.email, seat.claimCodeHash, seat.createdAt, now, gameId, now, moderatorId),
    );
  }
  for (const composition of backupComposition(data)) {
    statements.push(
      db.prepare('INSERT INTO game_role_counts (game_id, role_key, count, power_snapshot) SELECT ?, ?, ?, ? WHERE ' + restoreGuard)
        .bind(gameId, composition.roleKey, composition.count, composition.powerSnapshot, gameId, now, moderatorId),
    );
  }
  statements.push(
    db.prepare(
      "INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at) SELECT ?, ?, 'GAME_RESTORED', ?, ?, ? WHERE " + restoreGuard,
    ).bind(
      crypto.randomUUID(),
      gameId,
      moderatorId,
      JSON.stringify({ sourceBackupId: sourceBackup.id, sourceChecksum: sourceBackup.checksum, safetyBackupId: safetyBackup.backupId, status: 'DRAFT', restoredSeatCount: inviteRows.length }),
      now,
      gameId,
      now,
      moderatorId,
    ),
    db.prepare(
      "INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at) SELECT ?, ?, 'WARNING', 'GAME_CONTROL', 'A stored backup was restored to setup state.', ?, ? WHERE " + restoreGuard,
    ).bind(
      crypto.randomUUID(),
      gameId,
      JSON.stringify({ moderatorId, sourceBackupId: sourceBackup.id, sourceChecksum: sourceBackup.checksum, safetyBackupId: safetyBackup.backupId, restoredSeatCount: inviteRows.length }),
      now,
      gameId,
      now,
      moderatorId,
    ),
  );
  statements.push(
    db
      .prepare("UPDATE games SET status = 'DRAFT', updated_at = ? WHERE id = ? AND status = 'RESTORING' AND reset_at = ? AND reset_by_moderator_id = ?")
      .bind(now, gameId, now, moderatorId),
  );
  const result = await db.batch(statements);
  if (Number((result[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0) !== 1
    || Number((result[result.length - 1] as { meta?: { changes?: number } })?.meta?.changes ?? 0) !== 1) {
    throw new Error('The game changed while the backup was being restored. Refresh and try again.');
  }
  return {
    safetyBackupId: safetyBackup.backupId,
    safetyBackupChecksum: safetyBackup.checksum,
    sourceBackupId: sourceBackup.id,
    restoredSeatCount: inviteRows.length,
    inviteRows: inviteRows.map(({ displayName, email, claimUrl, inviteCode }) => ({ displayName, email, claimUrl, inviteCode })),
  };
}
