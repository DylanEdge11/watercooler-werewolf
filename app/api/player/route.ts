import { ensureDatabase } from '@/db/migrate';
import { getCurrentPlayer, getCurrentSpectator } from '@/lib/auth/session';
import { advanceGameSafely } from '@/lib/game/automation-sweep';
import { jsonError } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import { loadDashboard, loadSpectatorDashboard, type NotificationCursor } from '@/lib/player/dashboard-data';
import { respondJsonWithEtag } from '@/lib/http/etag';

// Player email is sent after the response, within this function's time limit: a result story, then up to 80 emails.
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const identity = await getCurrentPlayer();
    if (!identity) {
      // A spectator's device polls the same endpoint and gets the public, role-free view.
      const spectator = await getCurrentSpectator();
      if (!spectator) return jsonError('Player authentication required.', 401);
      const automation = await advanceGameSafely(spectator.gameId);
      const view = await loadSpectatorDashboard(spectator.spectatorId, { automation });
      if (!view) return jsonError('Spectator not found.', 404);
      return respondJsonWithEtag(request, { ok: true, ...view });
    }
    const requestUrl = new URL(request.url);
    const notificationBefore = requestUrl.searchParams.get('notificationBefore');
    const notificationBeforeId = requestUrl.searchParams.get('notificationBeforeId');
    if (
      (notificationBefore && Number.isNaN(new Date(notificationBefore).valueOf()))
      || (notificationBefore && !notificationBeforeId)
      || (!notificationBefore && notificationBeforeId)
    ) {
      return jsonError('The notification history cursor is invalid.', 400);
    }
    const cursor: NotificationCursor | undefined = notificationBefore && notificationBeforeId
      ? { before: notificationBefore, beforeId: notificationBeforeId }
      : undefined;
    // Any automatic step that is due (lock and calculate, Hunter follow-up, publish) happens
    // on this visit, so the game moves on even with no cron. When nothing is due, the sweep costs one query.
    const automation = await advanceGameSafely(identity.gameId);
    const dashboard = await loadDashboard(identity.seatId, { cursor, automation, gameId: identity.gameId });
    if (!dashboard) return jsonError('Player seat not found.', 404);
    return respondJsonWithEtag(request, { ok: true, ...dashboard });
  } catch (error) {
    return routeError(error, 'Unable to load the player dashboard.');
  }
}
