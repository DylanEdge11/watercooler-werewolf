import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { requireModerator } from '@/lib/auth/authorization';
import { hasModeratorAccount } from '@/lib/auth/moderators';
import { getCurrentModerator } from '@/lib/auth/session';
import { loadAssignmentsView, loadRosterView, type GameSummary } from '@/lib/game/setup-view';
import { DEFAULT_NEW_GAME_AUTOMATION, resolveAutomationSettings, type PublicationMode } from '@/lib/game/automation';
import { parseEliminationSchedule, resolveEliminationSchedule, serializeEliminationSchedule } from '@/lib/game/elimination-schedule';
import { DEFAULT_GAME_SETTINGS, resolveGameSettings, type GameSettingsInput } from '@/lib/game/game-settings';
import { validateGameSetup, type GameSetupInput } from '@/lib/game/game-setup';
import { formatZonedDateTimeLocal } from '@/lib/game/scheduling';
import { assertSameOrigin } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';

interface CreateGameBody extends GameSettingsInput, GameSetupInput {
  publicationMode?: unknown;
  reviewWindowMinutes?: unknown;
  eliminationSchedule?: unknown;
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
  publicationMode: PublicationMode;
  reviewWindowMinutes: number;
  automationPausedAt: string | null;
  dayDivisor: number;
  nightDivisor: number;
  eliminationScheduleJson: string | null;
  moderatorRole: string;
}

/**
 * The moderator's games, plus the roster and assignments of one selected game
 * (`?gameId=`, or the newest game), so the console starts and refreshes with
 * one request. Signed out, the 401 says whether the first moderator account
 * still has to be created.
 */
export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const moderator = await getCurrentModerator();
    if (!moderator) {
      return Response.json({ ok: false, error: 'Moderator authentication required.', needsBootstrap: !(await hasModeratorAccount()) }, { status: 401 });
    }
    const games = await getDb()
      .prepare(
        `SELECT g.id, g.name, g.status, g.timezone,
                g.start_date AS startDate, g.end_date AS endDate,
                g.active_weekdays_json AS activeWeekdaysJson,
                g.schedule_json AS scheduleJson,
                g.final_cutoff_at AS finalCutoffAt,
                g.hunter_window_minutes AS hunterWindowMinutes,
                g.day_divisor AS dayDivisor, g.night_divisor AS nightDivisor,
                g.elimination_schedule_json AS eliminationScheduleJson,
                g.publication_mode AS publicationMode, g.review_window_minutes AS reviewWindowMinutes,
                g.automation_paused_at AS automationPausedAt,
                gm.role AS moderatorRole
         FROM games g
         JOIN game_moderators gm ON gm.game_id = g.id
         WHERE gm.moderator_id = ?
         ORDER BY g.created_at DESC`,
      )
      .bind(moderator.id)
      .all<GameListRow>();
    const preferredGameId = new URL(request.url).searchParams.get('gameId');
    const selectedGame = games.results.find((game) => game.id === preferredGameId) ?? games.results[0];
    const [roster, assignments] = selectedGame
      ? await Promise.all([loadRosterView(selectedGame.id), loadAssignmentsView(selectedGame.id)])
      : [null, null];
    return respondJsonWithEtag(request, {
      ok: true,
      needsBootstrap: false,
      selected: selectedGame && roster && assignments ? { gameId: selectedGame.id, roster, assignments } : null,
      games: games.results.map((game): GameSummary => ({
        id: game.id,
        name: game.name,
        status: game.status,
        timezone: game.timezone,
        startDate: game.startDate,
        endDate: game.endDate,
        activeWeekdays: JSON.parse(game.activeWeekdaysJson) as number[],
        schedule: JSON.parse(game.scheduleJson) as GameSummary['schedule'],
        finalCutoffAt: game.finalCutoffAt,
        finalCutoffLocal: formatZonedDateTimeLocal(new Date(game.finalCutoffAt), game.timezone),
        hunterWindowMinutes: Number(game.hunterWindowMinutes),
        dayDivisor: Number(game.dayDivisor),
        nightDivisor: Number(game.nightDivisor),
        eliminationSchedule: parseEliminationSchedule(game.eliminationScheduleJson),
        publicationMode: game.publicationMode,
        reviewWindowMinutes: Number(game.reviewWindowMinutes),
        automationPaused: Boolean(game.automationPausedAt),
        moderatorRole: game.moderatorRole,
      })),
    });
  } catch (error) {
    return routeError(error, 'Unable to list games.');
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const moderator = await requireModerator();
    const body = (await request.json()) as CreateGameBody;
    const setup = validateGameSetup(body);
    const { settings, errors: settingsErrors } = resolveGameSettings(body, DEFAULT_GAME_SETTINGS);
    if (settingsErrors.length) throw new Error(settingsErrors.join(' '));
    // New games use moderator review unless the moderator opts in to automatic results.
    const { settings: automation, errors: automationErrors } = resolveAutomationSettings(body, DEFAULT_NEW_GAME_AUTOMATION);
    if (automationErrors.length) throw new Error(automationErrors.join(' '));
    const { schedule: eliminationSchedule, errors: eliminationErrors } = resolveEliminationSchedule(body.eliminationSchedule, null);
    if (eliminationErrors.length) throw new Error(eliminationErrors.join(' '));

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    await db.batch([
      db
        .prepare(
          `INSERT INTO games
           (id, name, status, timezone, start_date, end_date, active_weekdays_json, schedule_json,
            day_divisor, night_divisor, hunter_window_minutes, final_round_minutes,
            chat_retention_days, final_cutoff_at, publication_mode, review_window_minutes, elimination_schedule_json,
            created_by_moderator_id, created_at, updated_at)
           VALUES (?, ?, 'REGISTRATION', ?, ?, ?, ?, ?, ?, ?, ?, 60, 7, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          setup.name,
          setup.timezone,
          setup.startDate,
          setup.endDate,
          JSON.stringify(setup.activeWeekdays),
          JSON.stringify(setup.schedule),
          settings.dayDivisor,
          settings.nightDivisor,
          settings.hunterWindowMinutes,
          setup.finalCutoffAt.toISOString(),
          automation.publicationMode,
          automation.reviewWindowMinutes,
          serializeEliminationSchedule(eliminationSchedule),
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
        .bind(crypto.randomUUID(), id, moderator.id, JSON.stringify({ name: setup.name, eliminationSchedule }), now),
    ]);
    return Response.json({ ok: true, gameId: id }, { status: 201 });
  } catch (error) {
    return routeError(error, 'Unable to create game.');
  }
}
