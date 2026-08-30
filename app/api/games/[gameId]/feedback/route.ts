import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { validatePilotFeedback } from '../../../../../lib/game/feedback';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as { rating?: number; comment?: string };
    const feedback = validatePilotFeedback({ rating: body.rating, comment: body.comment });
    const now = new Date().toISOString();
    const feedbackId = crypto.randomUUID();
    const db = getD1();
    await db.batch([
      db
        .prepare(
          `INSERT INTO pilot_feedback (id, game_id, respondent_type, rating, comment, created_at)
           VALUES (?, ?, 'MODERATOR', ?, ?, ?)`,
        )
        .bind(feedbackId, gameId, feedback.rating, feedback.comment, now),
      db
        .prepare(
          `INSERT INTO operational_events
           (id, game_id, severity, source, message, details_json, created_at)
           VALUES (?, ?, 'INFO', 'PILOT_FEEDBACK', 'Pilot feedback was recorded.', ?, ?)`,
        )
        .bind(crypto.randomUUID(), gameId, JSON.stringify({ feedbackId, moderatorId: moderator.id, rating: feedback.rating }), now),
    ]);
    return Response.json({ ok: true, feedbackId, createdAt: now }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to record feedback.', 400);
  }
}
