import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator, requireGameOwner } from '../../../../../lib/auth/authorization';
import { createBackupRecord, restoreGameBackup } from '../../../../../lib/backup/snapshot';
import { canResetGame, canStopGame } from '../../../../../lib/game/lifecycle';
import { reconcileDuePhases } from '../../../../../lib/game/scheduling';
import { randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { restoreConfirmation } from '../../../../../lib/backup/restore';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const db = getD1();
    const reconciledPhaseIds = await reconcileDuePhases(db, gameId, moderator.id);
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const [game, membership, counts, overdue, sessions, backup, backups, events, activity] = await Promise.all([
      db
        .prepare(
      `SELECT status, name, chat_retention_days AS chatRetentionDays, final_cutoff_at AS finalCutoffAt,
                  stopped_at AS stoppedAt, stop_reason AS stopReason, updated_at AS updatedAt FROM games WHERE id = ? LIMIT 1`,
      )
        .bind(gameId)
        .first(),
      db
        .prepare('SELECT role FROM game_moderators WHERE game_id = ? AND moderator_id = ? LIMIT 1')
        .bind(gameId, moderator.id)
        .first<{ role: string }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS claimed,
                  SUM(CASE WHEN status = 'CLAIMED' AND alive = 1 THEN 1 ELSE 0 END) AS living
           FROM seats WHERE game_id = ? AND status != 'REMOVED'`,
        )
        .bind(gameId)
        .first(),
      db
        .prepare(
          `SELECT id, kind, closes_at AS closesAt FROM phases
           WHERE game_id = ? AND status IN ('OPEN', 'LOCKED') AND closes_at < ? ORDER BY sequence DESC LIMIT 1`,
        )
        .bind(gameId, new Date().toISOString())
        .first(),
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM seat_sessions ss JOIN seats s ON s.id = ss.seat_id
           WHERE s.game_id = ? AND ss.expires_at > ?`,
        )
        .bind(gameId, new Date().toISOString())
        .first(),
      db
        .prepare(
          `SELECT exported_at AS exportedAt, checksum FROM backup_exports
           WHERE game_id = ? ORDER BY exported_at DESC LIMIT 1`,
        )
        .bind(gameId)
        .first(),
      db
        .prepare(
          `SELECT id, schema_version AS schemaVersion, exported_at AS exportedAt, checksum
           FROM backup_exports WHERE game_id = ? ORDER BY exported_at DESC LIMIT 12`,
        )
        .bind(gameId)
        .all(),
      db
        .prepare(
          `SELECT id, severity, source, message, details_json AS detailsJson, created_at AS createdAt
           FROM operational_events WHERE game_id = ? ORDER BY created_at DESC LIMIT 20`,
        )
        .bind(gameId)
        .all(),
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM game_events WHERE game_id = ? AND event_type = 'ACTION_SUBMITTED' AND created_at >= ?) AS submittedActions,
             (SELECT COUNT(*) FROM operational_events WHERE game_id = ? AND source = 'DEADLINE_MONITOR' AND created_at >= ?) AS lateRejections,
             (SELECT MAX(created_at) FROM game_events WHERE game_id = ? AND event_type = 'ACTION_SUBMITTED') AS lastActionAt`,
        )
        .bind(gameId, since, gameId, since, gameId)
        .first<{ submittedActions: number; lateRejections: number; lastActionAt: string | null }>(),
    ]);
    return Response.json({ ok: true, viewerRole: membership?.role ?? null, game, counts, overduePhase: overdue, reconciledPhaseIds, activePlayerSessions: Number((sessions as { count?: number } | null)?.count ?? 0), activity: { submittedActions: Number(activity?.submittedActions ?? 0), lateRejections: Number(activity?.lateRejections ?? 0), lastActionAt: activity?.lastActionAt ?? null }, lastBackup: backup, backups: backups.results, events: events.results });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load operational health.', 401);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as {
      action?: 'SET_CHAT_RETENTION' | 'REVOKE_SEAT_SESSIONS' | 'STOP' | 'RESET' | 'RESTORE_BACKUP' | 'RECONCILE_DEADLINES';
      days?: number;
      seatId?: string;
      reason?: string;
      confirmed?: boolean;
      confirmationName?: string;
      backupId?: string;
    };
    const db = getD1();
    const now = new Date().toISOString();
    const game = await db
      .prepare('SELECT id, name, status FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ id: string; name: string; status: string }>();
    if (!game) throw new Error('Game not found.');
    if (body.action === 'RECONCILE_DEADLINES') {
      const lockedPhaseIds = await reconcileDuePhases(db, gameId, moderator.id);
      return Response.json({ ok: true, lockedPhaseIds });
    }
    if (body.action === 'STOP') {
      const reason = body.reason?.trim() ?? '';
      const decision = canStopGame(game.status, reason, body.confirmed === true);
      if (!decision.allowed) throw new Error(decision.error);
      if (decision.idempotent) return Response.json({ ok: true, idempotent: true, status: 'STOPPED' });
      await db.batch([
        db
          .prepare(
            `UPDATE games SET status = 'STOPPED', stopped_at = ?, stopped_by_moderator_id = ?, stop_reason = ?, updated_at = ?
             WHERE id = ? AND status NOT IN ('COMPLETED', 'CANCELLED', 'STOPPED')`,
          )
          .bind(now, moderator.id, reason, now, gameId),
        db
          .prepare(
            `UPDATE phases SET status = 'SUPERSEDED', updated_at = ?
             WHERE game_id = ? AND status IN ('SCHEDULED', 'OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL')`,
          )
          .bind(now, gameId),
        db.prepare("UPDATE chat_rooms SET status = 'READ_ONLY' WHERE game_id = ? AND status = 'OPEN'").bind(gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, 'GAME_STOPPED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ reason, status: 'STOPPED' }), now),
        db
          .prepare(
            `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
             VALUES (?, ?, 'WARNING', 'GAME_CONTROL', 'The game was stopped by a moderator.', ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ moderatorId: moderator.id, reason }), now),
      ]);
      return Response.json({ ok: true, status: 'STOPPED', stoppedAt: now });
    }
    if (body.action === 'RESET') {
      await requireGameOwner(gameId);
      const decision = canResetGame(game.status, game.name, body.confirmationName?.trim() ?? '', 'OWNER', body.confirmed === true);
      if (!decision.allowed) throw new Error(decision.error);
      if (decision.idempotent) return Response.json({ ok: true, idempotent: true, status: 'DRAFT' });
      const backup = await createBackupRecord(gameId, moderator.id);
      const seats = await db
        .prepare('SELECT id FROM seats WHERE game_id = ?')
        .bind(gameId)
        .all<{ id: string }>();
      const replacementHashes = await Promise.all(
        seats.results.map(async (seat) => ({ id: seat.id, hash: await sha256(randomToken(18)) })),
      );
      const statements: D1PreparedStatement[] = [
        db.prepare('DELETE FROM action_submissions WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?)').bind(gameId),
        db.prepare('DELETE FROM resolution_proposals WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?)').bind(gameId),
        db.prepare('UPDATE game_events SET phase_id = NULL WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?)').bind(gameId),
        db.prepare('DELETE FROM phases WHERE game_id = ?').bind(gameId),
        db.prepare('DELETE FROM role_assignments WHERE game_id = ?').bind(gameId),
        db.prepare('DELETE FROM assignment_batches WHERE game_id = ?').bind(gameId),
        db.prepare('DELETE FROM game_role_counts WHERE game_id = ?').bind(gameId),
        db.prepare('DELETE FROM notifications WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?)').bind(gameId),
        db.prepare('DELETE FROM chat_room_members WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?)').bind(gameId),
        db.prepare('DELETE FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?)').bind(gameId),
        db.prepare("UPDATE chat_rooms SET status = 'OPEN' WHERE game_id = ?").bind(gameId),
        db.prepare('DELETE FROM seat_sessions WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?)').bind(gameId),
        db
          .prepare(
            `UPDATE seats SET status = 'INVITED', pin_hash = NULL, session_version = session_version + 1,
                              alive = 1, predecessor_seat_id = NULL, claimed_at = NULL, updated_at = ? WHERE game_id = ?`,
          )
          .bind(now, gameId),
        db
          .prepare(
            `UPDATE games SET status = 'DRAFT', stopped_at = NULL, stopped_by_moderator_id = NULL, stop_reason = NULL,
                              reset_at = ?, reset_by_moderator_id = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(now, moderator.id, now, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, 'GAME_RESET', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ backupId: backup.backupId, checksum: backup.checksum, status: 'DRAFT' }), now),
        db
          .prepare(
            `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
             VALUES (?, ?, 'WARNING', 'GAME_CONTROL', 'The game was reset to setup state.', ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ moderatorId: moderator.id, backupId: backup.backupId }), now),
      ];
      for (const replacement of replacementHashes) {
        statements.push(db.prepare('UPDATE seats SET claim_code_hash = ? WHERE id = ? AND game_id = ?').bind(replacement.hash, replacement.id, gameId));
      }
      await db.batch(statements);
      return Response.json({ ok: true, status: 'DRAFT', backupId: backup.backupId, checksum: backup.checksum, resetAt: now });
    }
    if (body.action === 'RESTORE_BACKUP') {
      await requireGameOwner(gameId);
      const confirmationError = restoreConfirmation(game.name, body.confirmationName?.trim() ?? '', body.confirmed === true);
      if (confirmationError) throw new Error(confirmationError);
      if (!body.backupId) throw new Error('Choose a stored backup to restore.');
      const sourceBackup = await db
        .prepare(
          `SELECT id, game_id AS gameId, schema_version AS schemaVersion, checksum,
                  payload_json AS payloadJson FROM backup_exports
           WHERE id = ? AND game_id = ? LIMIT 1`,
        )
        .bind(body.backupId, gameId)
        .first<{ id: string; gameId: string; schemaVersion: number; checksum: string; payloadJson: string | null }>();
      if (!sourceBackup) throw new Error('The selected backup was not found for this game.');
      const restored = await restoreGameBackup(gameId, sourceBackup, moderator.id, new URL(request.url).origin);
      return Response.json({ ok: true, status: 'DRAFT', ...restored });
    }
    if (body.action === 'SET_CHAT_RETENTION') {
      if (!Number.isInteger(body.days) || Number(body.days) < 1 || Number(body.days) > 30) throw new Error('Chat retention must be 1–30 days.');
      await db.prepare('UPDATE games SET chat_retention_days = ?, updated_at = ? WHERE id = ?').bind(body.days, now, gameId).run();
      return Response.json({ ok: true, days: body.days });
    }
    if (body.action === 'REVOKE_SEAT_SESSIONS') {
      if (!body.seatId || (body.reason?.trim().length ?? 0) < 5) throw new Error('Choose a seat and provide a reason.');
      const seat = await db
        .prepare('SELECT id FROM seats WHERE id = ? AND game_id = ? LIMIT 1')
        .bind(body.seatId, gameId)
        .first();
      if (!seat) throw new Error('Seat not found.');
      await db.batch([
        db.prepare('UPDATE seats SET session_version = session_version + 1, updated_at = ? WHERE id = ?').bind(now, body.seatId),
        db.prepare('DELETE FROM seat_sessions WHERE seat_id = ?').bind(body.seatId),
        db
          .prepare(
            `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
             VALUES (?, ?, 'WARNING', 'SESSION_CONTROL', 'Player sessions were revoked.', ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ seatId: body.seatId, reason: body.reason?.trim(), moderatorId: moderator.id }), now),
      ]);
      return Response.json({ ok: true });
    }
    throw new Error('Unknown operational action.');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update operations.', 400);
  }
}
