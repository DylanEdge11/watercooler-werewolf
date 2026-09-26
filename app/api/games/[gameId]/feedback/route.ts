import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { getCurrentModerator, getCurrentPlayer } from '../../../../../lib/auth/session';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { summarizeFeedback, validatePilotFeedback, type FeedbackEntry } from '../../../../../lib/game/feedback';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../../lib/http/rate-limit';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

/** Moderators read every rating and comment for their game. Entries never say which player sent them. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const rows = await getDb()
      .prepare(
        `SELECT rating, comment, respondent_type AS respondentType, created_at AS createdAt
         FROM pilot_feedback WHERE game_id = ? ORDER BY created_at DESC`,
      )
      .bind(gameId)
      .all<FeedbackEntry>();
    return Response.json({ ok: true, feedback: summarizeFeedback(rows.results) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load feedback.', 401);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const body = (await request.json()) as { rating?: number; comment?: string };
    const feedback = validatePilotFeedback({ rating: body.rating, comment: body.comment });
    const now = new Date().toISOString();
    const feedbackId = crypto.randomUUID();
    const db = getDb();
    const moderator = await getCurrentModerator();
    let respondentType: 'MODERATOR' | 'PLAYER';
    let respondentId: string;
    if (moderator) {
      await requireGameModerator(gameId);
      respondentType = 'MODERATOR';
      respondentId = moderator.id;
      await enforceRateLimit(requestRateLimitKey(request, `moderator-feedback:${moderator.id}:${gameId}`), 10, 60 * 60_000);
    } else {
      const player = await getCurrentPlayer();
      if (!player || player.gameId !== gameId) throw new Error('Player authentication required for this game.');
      respondentType = 'PLAYER';
      respondentId = player.seatId;
      await enforceRateLimit(requestRateLimitKey(request, `player-feedback:${player.seatId}:${gameId}`), 3, 60 * 60_000);
    }
    await db.batch([
      db
        .prepare(
          `INSERT INTO pilot_feedback (id, game_id, respondent_type, rating, comment, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(feedbackId, gameId, respondentType, feedback.rating, feedback.comment, now),
      db
        .prepare(
          `INSERT INTO operational_events
           (id, game_id, severity, source, message, details_json, created_at)
           VALUES (?, ?, 'INFO', 'PILOT_FEEDBACK', 'Pilot feedback was recorded.', ?, ?)`,
        )
        .bind(crypto.randomUUID(), gameId, JSON.stringify({ feedbackId, respondentType, respondentId, rating: feedback.rating }), now),
    ]);
    return Response.json({ ok: true, feedbackId, createdAt: now }, { status: 201 });
  } catch (error) {
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to record feedback.', 400);
  }
}
