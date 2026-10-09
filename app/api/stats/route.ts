import { ensureDatabase } from '@/db/migrate';
import { getCurrentPlayer, getCurrentSpectator } from '@/lib/auth/session';
import { routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import { jsonError } from '@/lib/http/security';
import { loadGameStats } from '@/lib/player/game-stats-data';

/**
 * The Village stats of the signed-in player's (or spectator's) own game. Everything in it is
 * public to the game: published ballots, revealed roles, and chat counts.
 */
export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const identity = (await getCurrentPlayer()) ?? (await getCurrentSpectator());
    if (!identity) return jsonError('Player authentication required.', 401);
    const stats = await loadGameStats(identity.gameId);
    if (!stats) return jsonError('Game not found.', 404);
    return respondJsonWithEtag(request, { ok: true, stats });
  } catch (error) {
    return routeError(error, 'Unable to load the village stats.');
  }
}
