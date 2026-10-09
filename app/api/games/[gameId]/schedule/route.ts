import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { resolveAutomationSettings, type PublicationMode } from '@/lib/game/automation';
import { parseEliminationSchedule, resolveEliminationSchedule, serializeEliminationSchedule } from '@/lib/game/elimination-schedule';
import { resolveGameSettings, type GameSettingsInput } from '@/lib/game/game-settings';
import { validateGameSetup, type GameSetupInput } from '@/lib/game/game-setup';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { HttpError, routeError } from '@/lib/http/errors';
import { changes } from '@/db/results';
import type { RouteContext } from '@/lib/http/route-context';

interface UpdateScheduleBody extends GameSettingsInput, GameSetupInput {
  publicationMode?: unknown;
  reviewWindowMinutes?: unknown;
  eliminationSchedule?: unknown;
}

interface SetupGameRow {
  name: string;
  status: string;
  updatedAt: string;
  hunterWindowMinutes: number;
  publicationMode: PublicationMode;
  reviewWindowMinutes: number;
  dayDivisor: number;
  nightDivisor: number;
  eliminationScheduleJson: string | null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as UpdateScheduleBody;
    const setup = validateGameSetup(body);
    const { name, schedule, finalCutoffAt } = setup;

    const db = getDb();
    const game = await db
      .prepare(
        `SELECT name, status, updated_at AS updatedAt, hunter_window_minutes AS hunterWindowMinutes,
                day_divisor AS dayDivisor, night_divisor AS nightDivisor,
                publication_mode AS publicationMode, review_window_minutes AS reviewWindowMinutes,
                elimination_schedule_json AS eliminationScheduleJson
         FROM games WHERE id = ? LIMIT 1`,
      )
      .bind(gameId)
      .first<SetupGameRow>();
    if (!game) throw new HttpError(404, 'Game not found.');
    if (!['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(game.status)) {
      throw new Error('The game schedule is locked after roles are released. Reset or restore the game before changing it.');
    }
    const { settings, errors: settingsErrors } = resolveGameSettings(body, {
      hunterWindowMinutes: Number(game.hunterWindowMinutes),
      dayDivisor: Number(game.dayDivisor),
      nightDivisor: Number(game.nightDivisor),
    });
    if (settingsErrors.length) throw new Error(settingsErrors.join(' '));
    const { settings: automation, errors: automationErrors } = resolveAutomationSettings(body, {
      publicationMode: game.publicationMode,
      reviewWindowMinutes: Number(game.reviewWindowMinutes),
    });
    if (automationErrors.length) throw new Error(automationErrors.join(' '));
    const previousSchedule = parseEliminationSchedule(game.eliminationScheduleJson);
    const { schedule: eliminationSchedule, errors: eliminationErrors } = resolveEliminationSchedule(body.eliminationSchedule, previousSchedule);
    if (eliminationErrors.length) throw new Error(eliminationErrors.join(' '));
    const eliminationScheduleJson = serializeEliminationSchedule(eliminationSchedule);
    const scheduleChanged = eliminationScheduleJson !== serializeEliminationSchedule(previousSchedule);

    const now = new Date().toISOString();
    const updateGuard = `EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = ? AND g.updated_at = ? AND g.status IN ('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW')
    )`;
    const result = await db.batch([
      db
        .prepare(
          `UPDATE games
           SET name = ?, timezone = ?, start_date = ?, end_date = ?, active_weekdays_json = ?,
               schedule_json = ?, final_cutoff_at = ?, hunter_window_minutes = ?, day_divisor = ?,
               night_divisor = ?, publication_mode = ?, review_window_minutes = ?, elimination_schedule_json = ?, updated_at = ?
           WHERE id = ? AND updated_at = ? AND status IN ('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW')`,
        )
        .bind(
          name,
          setup.timezone,
          setup.startDate,
          setup.endDate,
          JSON.stringify(setup.activeWeekdays),
          JSON.stringify(schedule),
          finalCutoffAt.toISOString(),
          settings.hunterWindowMinutes,
          settings.dayDivisor,
          settings.nightDivisor,
          automation.publicationMode,
          automation.reviewWindowMinutes,
          eliminationScheduleJson,
          now,
          gameId,
          game.updatedAt,
        ),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'GAME_SCHEDULE_UPDATED', ?, ?, ? WHERE ${updateGuard}`,
        )
        .bind(
          crypto.randomUUID(),
          gameId,
          moderator.id,
          JSON.stringify({ previousName: game.name, name, timezone: body.timezone, startDate: body.startDate, endDate: body.endDate, ...settings, ...automation }),
          now,
          gameId,
          now,
        ),
      // The elimination schedule has its own audit entry, with before and after, whenever it changes.
      ...(scheduleChanged
        ? [db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, 'ELIMINATION_SCHEDULE_UPDATED', ?, ?, ? WHERE ${updateGuard}`,
          )
          .bind(
            crypto.randomUUID(),
            gameId,
            moderator.id,
            JSON.stringify({ previous: previousSchedule, schedule: eliminationSchedule, status: game.status }),
            now,
            gameId,
            now,
          )]
        : []),
    ]);
    if (changes(result[0]) !== 1) {
      return jsonError('The game changed while its schedule was being saved. Refresh and try again.', 409);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to update the game schedule.');
  }
}
