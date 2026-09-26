import { getDb } from '../../../db';
import { ensureDatabase } from '../../../db/migrate';
import { requireModerator } from '../../../lib/auth/authorization';
import { DEFAULT_GAME_SETTINGS, resolveGameSettings, type GameSettingsInput } from '../../../lib/game/game-settings';
import { assertValidCalendarDate, assertValidTimeZone, formatZonedDateTimeLocal, parseScheduledDate, validateSchedule } from '../../../lib/game/scheduling';
import { assertSameOrigin, jsonError } from '../../../lib/http/security';

interface CreateGameBody extends GameSettingsInput {
  name?: string;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  finalCutoffAt?: string;
  activeWeekdays?: number[];
  schedule?: Record<string, string>;
}

interface GameListRow {
  id: string;
  name: string;
  status: string;
  timezone: string;
  startDate: string;
  endDate: string;
  activeWeekdaysJson: string;
  scheduleJson: string;
  finalCutoffAt: string;
  hunterWindowMinutes: number;
  dayDivisor: number;
  nightDivisor: number;
  moderatorRole: string;
}

export async function GET() {
  try {
    await ensureDatabase();
    const moderator = await requireModerator();
    const games = await getDb()
      .prepare(
        `SELECT g.id, g.name, g.status, g.timezone,
                g.start_date AS startDate, g.end_date AS endDate,
                g.active_weekdays_json AS activeWeekdaysJson,
                g.schedule_json AS scheduleJson,
                g.final_cutoff_at AS finalCutoffAt,
                g.hunter_window_minutes AS hunterWindowMinutes,
                g.day_divisor AS dayDivisor, g.night_divisor AS nightDivisor,
                gm.role AS moderatorRole
         FROM games g
         JOIN game_moderators gm ON gm.game_id = g.id
         WHERE gm.moderator_id = ?
         ORDER BY g.created_at DESC`,
      )
      .bind(moderator.id)
      .all<GameListRow>();
    return Response.json({
      ok: true,
      games: games.results.map((game) => ({
        id: game.id,
        name: game.name,
        status: game.status,
        timezone: game.timezone,
        startDate: game.startDate,
        endDate: game.endDate,
        activeWeekdays: JSON.parse(game.activeWeekdaysJson) as number[],
        schedule: JSON.parse(game.scheduleJson) as Record<string, string>,
        finalCutoffAt: game.finalCutoffAt,
        finalCutoffLocal: formatZonedDateTimeLocal(new Date(game.finalCutoffAt), game.timezone),
        hunterWindowMinutes: Number(game.hunterWindowMinutes),
        dayDivisor: Number(game.dayDivisor),
        nightDivisor: Number(game.nightDivisor),
        moderatorRole: game.moderatorRole,
      })),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to list games.', 401);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const moderator = await requireModerator();
    const body = (await request.json()) as CreateGameBody;
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
    const scheduleErrors = validateSchedule({
      dayCloses: body.schedule.dayCloses ?? '',
      nightCloses: body.schedule.nightCloses ?? '',
      activeWeekdays: body.activeWeekdays,
    });
    if (scheduleErrors.length) throw new Error(scheduleErrors.join(' '));
    const { settings, errors: settingsErrors } = resolveGameSettings(body, DEFAULT_GAME_SETTINGS);
    if (settingsErrors.length) throw new Error(settingsErrors.join(' '));

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    await db.batch([
      db
        .prepare(
          `INSERT INTO games
           (id, name, status, timezone, start_date, end_date, active_weekdays_json, schedule_json,
            day_divisor, night_divisor, hunter_window_minutes, final_round_minutes,
            chat_retention_days, final_cutoff_at, publication_mode, created_by_moderator_id,
            created_at, updated_at)
           VALUES (?, ?, 'REGISTRATION', ?, ?, ?, ?, ?, ?, ?, ?, 60, 7, ?, 'REVIEW', ?, ?, ?)`,
        )
        .bind(
          id,
          name,
          body.timezone,
          body.startDate,
          body.endDate,
          JSON.stringify(body.activeWeekdays),
          JSON.stringify(body.schedule),
          settings.dayDivisor,
          settings.nightDivisor,
          settings.hunterWindowMinutes,
          finalCutoffAt.toISOString(),
          moderator.id,
          now,
          now,
        ),
      db
        .prepare('INSERT INTO game_moderators (game_id, moderator_id, role, added_at) VALUES (?, ?, ?, ?)')
        .bind(id, moderator.id, 'OWNER', now),
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           VALUES (?, ?, 'GAME_CREATED', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, moderator.id, JSON.stringify({ name }), now),
    ]);
    return Response.json({ ok: true, gameId: id }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to create game.', 400);
  }
}
