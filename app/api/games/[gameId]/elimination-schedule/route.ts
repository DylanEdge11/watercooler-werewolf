import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import {
  parseEliminationSchedule,
  resolveEliminationSchedule,
  serializeEliminationSchedule,
} from '../../../../../lib/game/elimination-schedule';
import { changes } from '../../../../../lib/game/phase-store';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

// Unlike the divisors, the schedule stays editable while the game runs, until it is over.
const EDITABLE = "('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW', 'ACTIVE', 'FINAL_SHOWDOWN')";

/**
 * Saves the elimination schedule from the live console. A saved change applies
 * to phases opened afterwards; every opened phase keeps the slots it recorded.
 * Each change is audited with the schedule before and after.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as { eliminationSchedule?: unknown };
    // Clearing the schedule is an explicit null, so a request that leaves it out changes nothing by accident.
    if (body.eliminationSchedule === undefined) throw new Error('Send the elimination schedule, or null to remove it.');
    const db = getDb();
    const game = await db
      .prepare('SELECT status, updated_at AS updatedAt, elimination_schedule_json AS eliminationScheduleJson FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ status: string; updatedAt: string; eliminationScheduleJson: string | null }>();
    if (!game) throw new HttpError(404, 'Game not found.');
    if (!EDITABLE.includes(`'${game.status}'`)) {
      return jsonError('The elimination schedule cannot change once a game is finished, stopped, or cancelled.', 409);
    }
    const previous = parseEliminationSchedule(game.eliminationScheduleJson);
    const { schedule, errors } = resolveEliminationSchedule(body.eliminationSchedule, previous);
    if (errors.length) throw new Error(errors.join(' '));
    const json = serializeEliminationSchedule(schedule);
    if (json === serializeEliminationSchedule(previous)) return Response.json({ ok: true, idempotent: true, eliminationSchedule: schedule });

    const now = new Date().toISOString();
    const result = await db.batch([
      db
        .prepare(
          `UPDATE games SET elimination_schedule_json = ?, updated_at = ?
           WHERE id = ? AND updated_at = ? AND status IN ${EDITABLE}`,
        )
        .bind(json, now, gameId, game.updatedAt),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'ELIMINATION_SCHEDULE_UPDATED', ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND updated_at = ? AND elimination_schedule_json IS ?)`,
        )
        .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ previous, schedule, status: game.status }), now, gameId, now, json),
    ]);
    if (changes(result[0]) !== 1) {
      return jsonError('The game changed while the elimination schedule was being saved. Refresh and try again.', 409);
    }
    return Response.json({ ok: true, eliminationSchedule: schedule });
  } catch (error) {
    return routeError(error, 'Unable to update the elimination schedule.');
  }
}
