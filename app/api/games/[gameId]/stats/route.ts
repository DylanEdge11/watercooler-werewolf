import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import { jsonError } from '@/lib/http/security';
import { loadGameStats } from '@/lib/player/game-stats-data';
import type { RouteContext } from '@/lib/http/route-context';

/** The same Village stats players see, for a moderator of this game. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const stats = await loadGameStats(gameId);
    if (!stats) return jsonError('Game not found.', 404);
    return respondJsonWithEtag(request, { ok: true, stats });
  } catch (error) {
    return routeError(error, 'Unable to load the village stats.');
  }
}
