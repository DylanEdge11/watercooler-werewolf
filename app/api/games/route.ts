import { getDb } from '../../../db';
import { ensureDatabase } from '../../../db/migrate';
import { requireModerator } from '../../../lib/auth/authorization';
import { assertValidCalendarDate, assertValidTimeZone, parseScheduledDate, validateSchedule } from '../../../lib/game/scheduling';
import { assertSameOrigin, jsonError } from '../../../lib/http/security';

interface CreateGameBody {
  name?: string;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  finalCutoffAt?: string;
  activeWeekdays?: number[];
  schedule?: Record<string, string>;
}

export async function GET() {
  try {
    await ensureDatabase();
    const moderator = await requireModerator();
    const games = await getDb()
      .prepare(
        `SELECT g.*, gm.role AS moderatorRole FROM games g
         JOIN game_moderators gm ON gm.game_id = g.id
         WHERE gm.moderator_id = ?
         ORDER BY g.created_at DESC`,
      )
      .bind(moderator.id)
      .all();
    return Response.json({ ok: true, games: games.results });
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
           VALUES (?, ?, 'REGISTRATION', ?, ?, ?, ?, ?, 30, 30, 60, 60, 7, ?, 'REVIEW', ?, ?, ?)`,
        )
        .bind(
          id,
          name,
          body.timezone,
          body.startDate,
          body.endDate,
          JSON.stringify(body.activeWeekdays),
          JSON.stringify(body.schedule),
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
