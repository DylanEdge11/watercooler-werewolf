import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { resolveAutoOpenNextPhase, resolveAutomationSettings, type PublicationMode } from '../../../../../lib/game/automation';
import { changes } from '../../../../../lib/game/phase-store';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

// Automation settings and pause can change at any point until the game is over.
const EDITABLE = "('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW', 'ACTIVE', 'FINAL_SHOWDOWN')";

/**
 * PAUSE and RESUME stop and restart every automatic step; SETTINGS chooses
 * automatic publication or moderator review, the review window, and whether the
 * next Day or Night opens by itself after a result publishes. Each change
 * is audited. A finished, stopped, or cancelled game answers 409.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as { action?: string; publicationMode?: unknown; reviewWindowMinutes?: unknown; autoOpenNextPhase?: unknown };
    if (!['PAUSE', 'RESUME', 'SETTINGS'].includes(body.action ?? '')) throw new Error('Choose pause, resume, or settings.');
    const db = getDb();
    const game = await db
      .prepare(
        `SELECT status, publication_mode AS publicationMode, review_window_minutes AS reviewWindowMinutes,
                automation_paused_at AS pausedAt, auto_open_next_phase AS autoOpenNextPhase
         FROM games WHERE id = ? LIMIT 1`,
      )
      .bind(gameId)
      .first<{ status: string; publicationMode: PublicationMode; reviewWindowMinutes: number; pausedAt: string | null; autoOpenNextPhase: number }>();
    if (!game) throw new HttpError(404, 'Game not found.');
    if (!EDITABLE.includes(`'${game.status}'`)) return jsonError('Automation cannot change once a game is finished, stopped, or cancelled.', 409);
    const now = new Date().toISOString();

    if (body.action === 'PAUSE' || body.action === 'RESUME') {
      const pausing = body.action === 'PAUSE';
      if (Boolean(game.pausedAt) === pausing) return Response.json({ ok: true, idempotent: true, paused: pausing });
      const result = await db.batch([
        db
          .prepare(
            `UPDATE games SET automation_paused_at = ?, updated_at = ?
             WHERE id = ? AND status IN ${EDITABLE} AND automation_paused_at IS ${pausing ? 'NULL' : 'NOT NULL'}`,
          )
          .bind(pausing ? now : null, now, gameId),
        db
          .prepare(
            `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, ?, ?, '{}', ? WHERE EXISTS (
               SELECT 1 FROM games WHERE id = ? AND updated_at = ? AND automation_paused_at IS ${pausing ? 'NOT NULL' : 'NULL'}
             )`,
          )
          .bind(crypto.randomUUID(), gameId, pausing ? 'AUTOMATION_PAUSED' : 'AUTOMATION_RESUMED', moderator.id, now, gameId, now),
      ]);
      if (changes(result[0]) !== 1) return jsonError('The game changed before automation could be updated. Refresh and try again.', 409);
      return Response.json({ ok: true, paused: pausing });
    }

    const { settings, errors } = resolveAutomationSettings(body, {
      publicationMode: game.publicationMode,
      reviewWindowMinutes: Number(game.reviewWindowMinutes),
    });
    const autoOpen = resolveAutoOpenNextPhase(body.autoOpenNextPhase, Boolean(game.autoOpenNextPhase));
    errors.push(...autoOpen.errors);
    if (errors.length) throw new Error(errors.join(' '));
    const result = await db.batch([
      db
        .prepare(
          `UPDATE games SET publication_mode = ?, review_window_minutes = ?, auto_open_next_phase = ?, updated_at = ?
           WHERE id = ? AND status IN ${EDITABLE}`,
        )
        .bind(settings.publicationMode, settings.reviewWindowMinutes, autoOpen.value ? 1 : 0, now, gameId),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, 'AUTOMATION_SETTINGS_UPDATED', ?, ?, ? WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND updated_at = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          gameId,
          moderator.id,
          JSON.stringify({
            ...settings,
            autoOpenNextPhase: autoOpen.value,
            previousPublicationMode: game.publicationMode,
            previousReviewWindowMinutes: Number(game.reviewWindowMinutes),
            previousAutoOpenNextPhase: Boolean(game.autoOpenNextPhase),
          }),
          now,
          gameId,
          now,
        ),
    ]);
    if (changes(result[0]) !== 1) return jsonError('The game changed before automation could be updated. Refresh and try again.', 409);
    return Response.json({ ok: true, ...settings, autoOpenNextPhase: autoOpen.value });
  } catch (error) {
    return routeError(error, 'Unable to update automation.');
  }
}
