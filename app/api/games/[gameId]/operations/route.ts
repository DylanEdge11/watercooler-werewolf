import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator, requireGameOwner } from '../../../../../lib/auth/authorization';
import { createBackupRecord, restoreGameBackup } from '../../../../../lib/backup/snapshot';
import { canCancelSetup, canResetGame, canStopGame } from '../../../../../lib/game/lifecycle';
import { reconcileDuePhases } from '../../../../../lib/game/scheduling';
import { hashSecret, randomToken, sha256 } from '../../../../../lib/auth/crypto';
import { PIN_LOCKOUT_ATTEMPTS, pinFailureKey } from '../../../../../lib/auth/pin-lockout';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { restoreConfirmation } from '../../../../../lib/backup/restore';
import { respondJsonWithEtag } from '../../../../../lib/http/etag';
import { endSpectatorsStatements } from '../../../../../lib/roster/spectators';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

interface OperationalEventRow {
  id: string;
  severity: string;
  source: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
}

/** A result email records whether its story came from the AI or the template; the console shows which. */
function storySource(detailsJson: string | null): 'AI' | 'TEMPLATE' | null {
  try {
    const details = JSON.parse(detailsJson ?? 'null') as { storySource?: unknown } | null;
    return details?.storySource === 'AI' || details?.storySource === 'TEMPLATE' ? details.storySource : null;
  } catch {
    return null;
  }
}

function changes(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const db = getDb();
    const reconciledPhaseIds = await reconcileDuePhases(db, gameId, moderator.id);
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const [game, membership, counts, overdue, sessions, backups, events, activity, seats] = await Promise.all([
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
          `SELECT id, schema_version AS schemaVersion, exported_at AS exportedAt, checksum
           FROM backup_exports WHERE game_id = ? ORDER BY exported_at DESC LIMIT 12`,
        )
        .bind(gameId)
        .all(),
      db
        .prepare(
          // The event log. Late-attempt rows are left out: the activity count below covers them,
          // and one player retrying after a deadline would otherwise push everything else off the list.
          `SELECT id, severity, source, message, details_json AS detailsJson, created_at AS createdAt
           FROM operational_events WHERE game_id = ? AND source != 'DEADLINE_MONITOR' ORDER BY created_at DESC LIMIT 20`,
        )
        .bind(gameId)
        .all<OperationalEventRow>(),
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM game_events WHERE game_id = ? AND event_type = 'ACTION_SUBMITTED' AND created_at >= ?) AS submittedActions,
             (SELECT COUNT(*) FROM operational_events WHERE game_id = ? AND source = 'DEADLINE_MONITOR' AND created_at >= ?) AS lateRejections,
             (SELECT MAX(created_at) FROM game_events WHERE game_id = ? AND event_type = 'ACTION_SUBMITTED') AS lastActionAt`,
        )
        .bind(gameId, since, gameId, since, gameId)
        .first<{ submittedActions: number; lateRejections: number; lastActionAt: string | null }>(),
      db
        .prepare(
          `SELECT s.id, s.display_name AS displayName, s.status,
                  COALESCE((SELECT b.attempts FROM rate_limit_buckets b WHERE b.bucket_key = 'pin-failures:' || s.id), 0) >= ? AS pinLocked
           FROM seats s WHERE s.game_id = ? AND s.status != 'REMOVED'
           ORDER BY s.display_name COLLATE NOCASE`,
        )
        .bind(PIN_LOCKOUT_ATTEMPTS, gameId)
        .all<{ id: string; displayName: string; status: string; pinLocked: number }>(),
    ]);
    const latestBackup = backups.results[0];
    const lastBackup = latestBackup ? { exportedAt: latestBackup.exportedAt, checksum: latestBackup.checksum } : null;
    return respondJsonWithEtag(request, { ok: true, viewerRole: membership?.role ?? null, game, counts, overduePhase: overdue, reconciledPhaseIds, activePlayerSessions: Number((sessions as { count?: number } | null)?.count ?? 0), activity: { submittedActions: Number(activity?.submittedActions ?? 0), lateRejections: Number(activity?.lateRejections ?? 0), lastActionAt: activity?.lastActionAt ?? null }, seats: seats.results.map((seat) => ({ ...seat, pinLocked: Boolean(seat.pinLocked) })), lastBackup, backups: backups.results, events: events.results.map(({ detailsJson, ...event }) => ({ ...event, storySource: storySource(detailsJson) })) });
  } catch (error) {
    return routeError(error, 'Unable to load operational health.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as {
      action?: 'SET_CHAT_RETENTION' | 'REVOKE_SEAT_SESSIONS' | 'RESET_PLAYER_PIN' | 'STOP' | 'RESET' | 'CANCEL_SETUP' | 'RESTORE_BACKUP' | 'RECONCILE_DEADLINES';
      days?: number;
      seatId?: string;
      newPin?: string;
      reason?: string;
      confirmed?: boolean;
      confirmationName?: string;
      backupId?: string;
    };
    const db = getDb();
    const now = new Date().toISOString();
    const game = await db
      .prepare('SELECT id, name, status, updated_at AS updatedAt FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ id: string; name: string; status: string; updatedAt: string }>();
    if (!game) throw new HttpError(404, 'Game not found.');
    if (body.action === 'CANCEL_SETUP') {
      await requireGameOwner(gameId);
      const decision = canCancelSetup(game.status, game.name, body.confirmationName?.trim() ?? '', 'OWNER', body.confirmed === true);
      if (!decision.allowed) throw new Error(decision.error);
      const seats = await db
        .prepare("SELECT id FROM seats WHERE game_id = ? AND status != 'REMOVED'")
        .bind(gameId)
        .all<{ id: string }>();
      const replacementHashes = await Promise.all(
        seats.results.map(async (seat) => ({ id: seat.id, hash: await sha256(randomToken(18)) })),
      );
      const cancelGuard = "EXISTS (SELECT 1 FROM games g WHERE g.id = ? AND g.status = 'CANCELLED' AND g.updated_at = ?)";
      const statements = [
        db
          .prepare(
            `UPDATE games SET status = 'CANCELLED', stopped_at = NULL, stopped_by_moderator_id = NULL, stop_reason = NULL, updated_at = ?
             WHERE id = ? AND status = ? AND updated_at = ?
               AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
          )
          .bind(now, gameId, game.status, game.updatedAt),
        db.prepare('DELETE FROM seat_sessions WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?) AND ' + cancelGuard).bind(gameId, gameId, now),
        db
          .prepare(
            `UPDATE seats SET status = 'REMOVED', pin_hash = NULL, session_version = session_version + 1,
                              alive = 0, claimed_at = NULL, updated_at = ?
             WHERE game_id = ? AND ${cancelGuard}`,
          )
          .bind(now, gameId, gameId, now),
        db.prepare('UPDATE chat_rooms SET status = \'READ_ONLY\' WHERE game_id = ? AND ' + cancelGuard).bind(gameId, gameId, now),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, 'GAME_CANCELLED', ?, ?, ? WHERE ${cancelGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ status: 'CANCELLED', invalidatedSeatCount: seats.results.length }), now, gameId, now),
        db
          .prepare(
            `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
             SELECT ?, ?, 'WARNING', 'GAME_CONTROL', 'An unfinished game setup was cancelled.', ?, ? WHERE ${cancelGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ moderatorId: moderator.id, invalidatedSeatCount: seats.results.length, auditHistoryRetained: true }), now, gameId, now),
      ];
      for (const replacement of replacementHashes) {
        statements.push(
          db
            .prepare('UPDATE seats SET claim_code_hash = ? WHERE id = ? AND game_id = ? AND ' + cancelGuard)
            .bind(replacement.hash, replacement.id, gameId, gameId, now),
        );
      }
      const result = await db.batch(statements);
      if (changes(result[0]) !== 1) {
        return jsonError('The setup changed before it could be cancelled. Refresh and review its current state.', 409);
      }
      return Response.json({ ok: true, status: 'CANCELLED', invalidatedSeatCount: seats.results.length });
    }
    if (body.action === 'RECONCILE_DEADLINES') {
      const lockedPhaseIds = await reconcileDuePhases(db, gameId, moderator.id);
      return Response.json({ ok: true, lockedPhaseIds });
    }
    if (body.action === 'STOP') {
      const reason = body.reason?.trim() ?? '';
      const decision = canStopGame(game.status, reason, body.confirmed === true);
      if (!decision.allowed) throw new Error(decision.error);
      if (decision.idempotent) return Response.json({ ok: true, idempotent: true, status: 'STOPPED' });
      const stopGuard = `EXISTS (
        SELECT 1 FROM games
        WHERE id = ? AND status = 'STOPPED' AND stopped_at = ?
          AND stopped_by_moderator_id = ? AND stop_reason = ?
      )`;
      const result = await db.batch([
        db
          .prepare(
            `UPDATE games SET status = 'STOPPED', stopped_at = ?, stopped_by_moderator_id = ?, stop_reason = ?, updated_at = ?
             WHERE id = ? AND status NOT IN ('COMPLETED', 'CANCELLED', 'STOPPED')`,
          )
          .bind(now, moderator.id, reason, now, gameId),
        db
          .prepare(
            `UPDATE phases SET status = 'SUPERSEDED', updated_at = ?
              WHERE game_id = ? AND status IN ('SCHEDULED', 'OPEN', 'LOCKED', 'HUNTER_FINALIZING', 'PENDING_HUNTER', 'PENDING_APPROVAL', 'PUBLISHING')
                AND ${stopGuard}`,
          )
          .bind(now, gameId, gameId, now, moderator.id, reason),
        db.prepare(`UPDATE chat_rooms SET status = 'READ_ONLY' WHERE game_id = ? AND status = 'OPEN' AND ${stopGuard}`).bind(gameId, gameId, now, moderator.id, reason),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, 'GAME_STOPPED', ?, ?, ? WHERE ${stopGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ reason, status: 'STOPPED' }), now, gameId, now, moderator.id, reason),
        db
          .prepare(
            `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
             SELECT ?, ?, 'WARNING', 'GAME_CONTROL', 'The game was stopped by a moderator.', ?, ? WHERE ${stopGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ moderatorId: moderator.id, reason }), now, gameId, now, moderator.id, reason),
      ]);
      if (Number((result[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0) !== 1) {
        return jsonError('The game changed before it could be stopped. Refresh and review its current state.', 409);
      }
      return Response.json({ ok: true, status: 'STOPPED', stoppedAt: now });
    }
    if (body.action === 'RESET') {
      await requireGameOwner(gameId);
      const decision = canResetGame(game.status, game.name, body.confirmationName?.trim() ?? '', 'OWNER', body.confirmed === true);
      if (!decision.allowed) throw new Error(decision.error);
      if (decision.idempotent) return Response.json({ ok: true, idempotent: true, status: 'DRAFT' });
      const backup = await createBackupRecord(gameId, moderator.id);
      const seats = await db
        .prepare("SELECT id FROM seats WHERE game_id = ? AND status != 'REMOVED'")
        .bind(gameId)
        .all<{ id: string }>();
      const replacementHashes = await Promise.all(
        seats.results.map(async (seat) => ({ id: seat.id, hash: await sha256(randomToken(18)) })),
      );
      const resetGuard = "EXISTS (SELECT 1 FROM games g WHERE g.id = ? AND g.status = 'RESETTING' AND g.reset_at = ? AND g.reset_by_moderator_id = ?)";
      const statements = [
        db
          .prepare("UPDATE games SET status = 'RESETTING', setup_revision = setup_revision + 1, reset_at = ?, reset_by_moderator_id = ?, updated_at = ? WHERE id = ? AND status = ? AND updated_at = ?")
          .bind(now, moderator.id, now, gameId, game.status, game.updatedAt),
        db.prepare('DELETE FROM action_submissions WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM resolution_proposals WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('UPDATE game_events SET phase_id = NULL WHERE phase_id IN (SELECT id FROM phases WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM phases WHERE game_id = ? AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM role_assignments WHERE game_id = ? AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM assignment_batches WHERE game_id = ? AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM game_role_counts WHERE game_id = ? AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM notifications WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        // Announcements belong to the run that is being cleared, as with Restore; their audit events stay.
        db.prepare('DELETE FROM announcements WHERE game_id = ? AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM chat_room_members WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM chat_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM moderator_messages WHERE room_id IN (SELECT id FROM chat_rooms WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        ...endSpectatorsStatements(db, gameId, now, resetGuard, [gameId, now, moderator.id]),
        db.prepare("UPDATE chat_rooms SET status = 'OPEN' WHERE game_id = ? AND " + resetGuard).bind(gameId, gameId, now, moderator.id),
        db.prepare('DELETE FROM seat_sessions WHERE seat_id IN (SELECT id FROM seats WHERE game_id = ?) AND ' + resetGuard).bind(gameId, gameId, now, moderator.id),
        db
          .prepare(
            "UPDATE seats SET status = 'INVITED', pin_hash = NULL, session_version = session_version + 1, alive = 1, predecessor_seat_id = NULL, claimed_at = NULL, updated_at = ? WHERE game_id = ? AND status != 'REMOVED' AND " + resetGuard,
          )
          .bind(now, gameId, gameId, now, moderator.id),
        db
          .prepare(
            "INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at) SELECT ?, ?, 'GAME_RESET', ?, ?, ? WHERE " + resetGuard,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ backupId: backup.backupId, checksum: backup.checksum, status: 'DRAFT' }), now, gameId, now, moderator.id),
        db
          .prepare(
            "INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at) SELECT ?, ?, 'WARNING', 'GAME_CONTROL', 'The game was reset to setup state.', ?, ? WHERE " + resetGuard,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ moderatorId: moderator.id, backupId: backup.backupId }), now, gameId, now, moderator.id),
      ];
      for (const replacement of replacementHashes) {
        statements.push(
          db
            .prepare("UPDATE seats SET claim_code_hash = ? WHERE id = ? AND game_id = ? AND status != 'REMOVED' AND " + resetGuard)
            .bind(replacement.hash, replacement.id, gameId, gameId, now, moderator.id),
        );
      }
      statements.push(
        db
          .prepare("UPDATE games SET status = 'DRAFT', automation_paused_at = NULL, auto_open_next_phase = 0, stopped_at = NULL, stopped_by_moderator_id = NULL, stop_reason = NULL, updated_at = ? WHERE id = ? AND status = 'RESETTING' AND reset_at = ? AND reset_by_moderator_id = ?")
          .bind(now, gameId, now, moderator.id),
      );
      const result = await db.batch(statements);
      if (changes(result[0]) !== 1 || changes(result[result.length - 1]) !== 1) {
        return jsonError('The game changed while reset was being prepared. Refresh and run recovery again.', 409);
      }
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
      if (!seat) throw new HttpError(404, 'Seat not found.');
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
    if (body.action === 'RESET_PLAYER_PIN') {
      const newPin = body.newPin?.trim() ?? '';
      if (!body.seatId || !/^\d{6}$/u.test(newPin)) throw new Error('Choose a claimed seat and a six-digit replacement PIN.');
      const reason = body.reason?.trim() ?? '';
      if (reason.length < 5) throw new Error('PIN reset requires a reason of at least 5 characters.');
      const seat = await db
        .prepare('SELECT id, session_version AS sessionVersion, status FROM seats WHERE id = ? AND game_id = ? LIMIT 1')
        .bind(body.seatId, gameId)
        .first<{ id: string; sessionVersion: number; status: string }>();
      if (!seat || seat.status !== 'CLAIMED') throw new Error('Only a claimed seat can receive a replacement PIN.');
      const pinHash = await hashSecret(newPin);
      const nextVersion = Number(seat.sessionVersion) + 1;
      const pinResetGuard = `EXISTS (
        SELECT 1 FROM seats
        WHERE id = ? AND game_id = ? AND status = 'CLAIMED'
          AND session_version = ? AND updated_at = ?
      )`;
      const resetResult = await db.batch([
        db
          .prepare(
            `UPDATE seats SET pin_hash = ?, session_version = session_version + 1, updated_at = ?
             WHERE id = ? AND game_id = ? AND status = 'CLAIMED' AND session_version = ?`,
          )
          .bind(pinHash, now, seat.id, gameId, seat.sessionVersion),
        db.prepare(`DELETE FROM seat_sessions WHERE seat_id = ? AND ${pinResetGuard}`).bind(seat.id, seat.id, gameId, nextVersion, now),
        // A new PIN unlocks a seat that was locked after too many wrong PINs.
        db.prepare(`DELETE FROM rate_limit_buckets WHERE bucket_key = ? AND ${pinResetGuard}`).bind(pinFailureKey(seat.id), seat.id, gameId, nextVersion, now),
        db
          .prepare(
            `INSERT INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
             SELECT ?, ?, 'WARNING', 'PLAYER_ACCESS', 'A player PIN was reset by a moderator.', ?, ?
             WHERE ${pinResetGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, JSON.stringify({ seatId: seat.id, reason, moderatorId: moderator.id }), now, seat.id, gameId, nextVersion, now),
      ]);
      if (Number((resetResult[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0) !== 1) {
        return jsonError('The player seat changed before its PIN could be reset. Refresh and try again.', 409);
      }
      return Response.json({ ok: true, seatId: seat.id, sessionVersion: nextVersion });
    }
    throw new Error('Unknown operational action.');
  } catch (error) {
    return routeError(error, 'Unable to update operations.');
  }
}
