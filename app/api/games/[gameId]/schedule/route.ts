import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { resolveAutomationSettings, type PublicationMode } from '../../../../../lib/game/automation';
import { resolveGameSettings, type GameSettingsInput } from '../../../../../lib/game/game-settings';
import { assertValidCalendarDate, assertValidTimeZone, parseScheduledDate, validateSchedule } from '../../../../../lib/game/scheduling';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

interface UpdateScheduleBody extends GameSettingsInput {
  publicationMode?: unknown;
  reviewWindowMinutes?: unknown;
  name?: string;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  finalCutoffAt?: string;
  activeWeekdays?: number[];
  schedule?: Record<string, string>;
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
}

function changes(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as UpdateScheduleBody;
    const name = body.name?.trim() ?? '';
    if (name.length < 3 || name.length > 80) throw new Error('Game name must be 3–80 characters.');
    if (!body.timezone) throw new Error('A game timezone is required.');
    assertValidTimeZone(body.timezone);
    if (!body.startDate || !body.endDate || !body.finalCutoffAt) throw new Error('Start, end, and final cutoff are required.');
    assertValidCalendarDate(body.startDate, 'Start date');
    assertValidCalendarDate(body.endDate, 'End date');
    if (body.startDate > body.endDate) throw new Error('The end date must be on or after the start date.');
    const finalCutoffAt = parseScheduledDate(body.finalCutoffAt, body.timezone);
    if (
      !body.activeWeekdays?.length ||
      body.activeWeekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    ) {
      throw new Error('Choose at least one valid active weekday.');
    }
    if (!body.schedule || Object.keys(body.schedule).length === 0) throw new Error('Enter the phase schedule.');
    const schedule = {
      dayCloses: body.schedule.dayCloses ?? '',
      nightCloses: body.schedule.nightCloses ?? '',
    };
    const scheduleErrors = validateSchedule({ ...schedule, activeWeekdays: body.activeWeekdays });
    if (scheduleErrors.length) throw new Error(scheduleErrors.join(' '));

    const db = getDb();
    const game = await db
      .prepare(
        `SELECT name, status, updated_at AS updatedAt, hunter_window_minutes AS hunterWindowMinutes,
                day_divisor AS dayDivisor, night_divisor AS nightDivisor,
                publication_mode AS publicationMode, review_window_minutes AS reviewWindowMinutes
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
               night_divisor = ?, publication_mode = ?, review_window_minutes = ?, updated_at = ?
           WHERE id = ? AND updated_at = ? AND status IN ('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW')`,
        )
        .bind(
          name,
          body.timezone,
          body.startDate,
          body.endDate,
          JSON.stringify(body.activeWeekdays),
          JSON.stringify(schedule),
          finalCutoffAt.toISOString(),
          settings.hunterWindowMinutes,
          settings.dayDivisor,
          settings.nightDivisor,
          automation.publicationMode,
          automation.reviewWindowMinutes,
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
    ]);
    if (changes(result[0]) !== 1) {
      return jsonError('The game changed while its schedule was being saved. Refresh and try again.', 409);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to update the game schedule.');
  }
}
