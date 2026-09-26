import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { recapText } from '../../../../../lib/game/recap';
import { loadGameRecap } from '../../../../../lib/game/recap-data';
import { jsonError } from '../../../../../lib/http/security';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

/** The same recap players see, plus plain text for "Copy recap". Completed games only. */
export async function GET(_request: Request, context: RouteContext) {
  const { gameId } = await context.params;
  try {
    await ensureDatabase();
    await requireGameModerator(gameId);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Moderator authentication required.', 401);
  }
  try {
    const result = await loadGameRecap(gameId);
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ ok: true, gameName: result.gameName, recap: result.recap, text: recapText(result.recap, result.gameName) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load the recap.', 400);
  }
}
