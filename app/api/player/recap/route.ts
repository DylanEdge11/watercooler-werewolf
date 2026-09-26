import { ensureDatabase } from '../../../../db/migrate';
import { getCurrentPlayer } from '../../../../lib/auth/session';
import { loadGameRecap } from '../../../../lib/game/recap-data';
import { jsonError } from '../../../../lib/http/security';

/** The end-of-game recap for a signed-in player. Only completed games have one. */
export async function GET() {
  try {
    await ensureDatabase();
    const identity = await getCurrentPlayer();
    if (!identity) return jsonError('Player authentication required.', 401);
    const result = await loadGameRecap(identity.gameId);
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ ok: true, gameName: result.gameName, recap: result.recap });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load the recap.', 400);
  }
}
