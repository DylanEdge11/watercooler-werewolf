import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const db = getD1();
    const [game, counts, overdue, sessions, backup, events] = await Promise.all([
      db
        .prepare(
          `SELECT status, chat_retention_days AS chatRetentionDays, final_cutoff_at AS finalCutoffAt,
                  updated_at AS updatedAt FROM games WHERE id = ? LIMIT 1`,
        )
        .bind(gameId)
        .first(),
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
           WHERE game_id = ? AND status = 'OPEN' AND closes_at < ? ORDER BY sequence DESC LIMIT 1`,
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
          `SELECT id, severity, source, message, details_json AS detailsJson, created_at AS createdAt
           FROM operational_events WHERE game_id = ? ORDER BY created_at DESC LIMIT 20`,
        )
        .bind(gameId)
        .all(),
    ]);
    return Response.json({ ok: true, game, counts, overduePhase: overdue, activePlayerSessions: Number((sessions as { count?: number } | null)?.count ?? 0), lastBackup: backup, events: events.results });
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
      action?: 'SET_CHAT_RETENTION' | 'REVOKE_SEAT_SESSIONS';
      days?: number;
      seatId?: string;
      reason?: string;
    };
    const db = getD1();
    const now = new Date().toISOString();
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
