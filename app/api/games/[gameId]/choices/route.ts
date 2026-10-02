import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { loadModeratorChoices } from '../../../../../lib/game/moderator-choices-data';
import { routeError } from '../../../../../lib/http/errors';
import { respondJsonWithEtag } from '../../../../../lib/http/etag';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

/** Every player's saved choice in every phase, for a moderator of this game only. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const phases = await loadModeratorChoices(gameId);
    return respondJsonWithEtag(request, { ok: true, phases });
  } catch (error) {
    return routeError(error, 'Unable to load player choices.');
  }
}
