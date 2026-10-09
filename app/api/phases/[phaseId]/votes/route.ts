import { ensureDatabase } from '@/db/migrate';
import { getCurrentPlayer, getCurrentSpectator } from '@/lib/auth/session';
import { routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import { jsonError } from '@/lib/http/security';
import { loadBallotVotes } from '@/lib/player/dashboard-data';
import type { RouteContext } from '@/lib/http/route-context';

/** Who voted for whom in one published Day or Final ballot of the player's (or spectator's) own game. */
export async function GET(request: Request, context: RouteContext<{ phaseId: string }>) {
  try {
    await ensureDatabase();
    const identity = (await getCurrentPlayer()) ?? (await getCurrentSpectator());
    if (!identity) return jsonError('Player authentication required.', 401);
    const { phaseId } = await context.params;
    const votes = await loadBallotVotes(identity.gameId, phaseId);
    if (!votes) return jsonError('Published ballot not found.', 404);
    return respondJsonWithEtag(request, { ok: true, phaseId, votes });
  } catch (error) {
    return routeError(error, 'Unable to load these votes.');
  }
}
