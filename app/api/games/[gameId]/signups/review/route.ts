import { getDb } from '../../../../../../db';
import { changes } from '../../../../../../db/results';
import { ensureDatabase } from '../../../../../../db/migrate';
import { requireGameModerator } from '../../../../../../lib/auth/authorization';
import { canReviewSignups, MAX_OPEN_SIGNUPS } from '../../../../../../lib/game/signups';
import { HttpError, routeError } from '../../../../../../lib/http/errors';
import { assertSameOrigin } from '../../../../../../lib/http/security';
import { acceptSignups } from '../../../../../../lib/roster/accept-signups';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

const DECISIONS = ['ACCEPT', 'DECLINE', 'RESTORE'] as const;
type Decision = (typeof DECISIONS)[number];

/**
 * Accepts, declines, or puts back waiting sign-ups. Accepting adds the players to the roster as
 * unclaimed seats (lib/roster/accept-signups.ts) and returns their private links once.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body: unknown = await request.json().catch(() => null);
    const raw = (body && typeof body === 'object' ? body : {}) as { decision?: unknown; signupIds?: unknown };
    if (typeof raw.decision !== 'string' || !(DECISIONS as readonly string[]).includes(raw.decision)) throw new Error('Choose ACCEPT, DECLINE, or RESTORE.');
    const decision = raw.decision as Decision;
    const ids = raw.signupIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_OPEN_SIGNUPS || ids.some((id) => typeof id !== 'string' || id.length > 64)) {
      throw new Error('Choose the sign-ups to change.');
    }
    const signupIds = ids as string[];

    const db = getDb();
    const game = await db
      .prepare('SELECT status, EXISTS (SELECT 1 FROM role_assignments WHERE game_id = games.id) AS released FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<{ status: string; released: number }>();
    if (!game) throw new HttpError(404, 'Game not found.');
    const allowed = canReviewSignups(game.status, Boolean(Number(game.released)));
    if (!allowed.allowed) throw new HttpError(409, allowed.error);

    if (decision === 'ACCEPT') {
      const result = await acceptSignups({ gameId, moderatorId: moderator.id, signupIds, origin: new URL(request.url).origin });
      return Response.json({ ok: true, ...result });
    }

    const now = new Date().toISOString();
    const [from, to] = decision === 'DECLINE' ? ['PENDING', 'DECLINED'] : ['DECLINED', 'PENDING'];
    const placeholders = signupIds.map(() => '?').join(', ');
    const gameGuard = "EXISTS (SELECT 1 FROM games g WHERE g.id = ? AND g.status IN ('DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW') AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = g.id))";
    // Declining and putting back both stamp the time and the moderator, which also lets the audit event
    // tie itself to this request's change and not to an earlier one.
    const results = await db.batch([
      db
        .prepare(
          `UPDATE signups SET status = ?, decided_at = ?, decided_by_moderator_id = ?
           WHERE game_id = ? AND status = ? AND seat_id IS NULL AND id IN (${placeholders}) AND ${gameGuard}`,
        )
        .bind(to, now, moderator.id, gameId, from, ...signupIds, gameId),
      db
        .prepare(
          `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM signups WHERE game_id = ? AND id IN (${placeholders}) AND status = ? AND decided_at = ?)`,
        )
        .bind(crypto.randomUUID(), gameId, decision === 'DECLINE' ? 'SIGNUPS_DECLINED' : 'SIGNUPS_RESTORED', moderator.id, JSON.stringify({ signupIds }), now, gameId, ...signupIds, to, now),
    ]);
    const changed = changes(results[0]);
    if (!changed) throw new HttpError(409, 'Those sign-ups have already been dealt with. Refresh the list.');
    return Response.json({ ok: true, changed });
  } catch (error) {
    return routeError(error, 'Unable to update the sign-ups.');
  }
}
