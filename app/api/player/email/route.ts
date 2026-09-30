import { ensureDatabase } from '../../../../db/migrate';
import { getCurrentPlayer } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../lib/http/rate-limit';
import { emailNotificationsAvailable } from '../../../../lib/notify/config';
import { saveEmailPreference } from '../../../../lib/notify/preferences';

/** A player turns their own game email on or off. It is off until they choose. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const identity = await getCurrentPlayer();
    if (!identity) return jsonError('Player authentication required.', 401);
    const body = await request.json().catch(() => ({})) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') return jsonError('Choose whether to turn email on or off.', 400);
    if (body.enabled && !emailNotificationsAvailable()) return jsonError('This site is not set up to send email.', 503);
    await enforceRateLimit(requestRateLimitKey(request, `email-preference:${identity.seatId}`), 20, 60 * 60_000);
    await saveEmailPreference(identity.seatId, body.enabled);
    return Response.json({ ok: true, enabled: body.enabled });
  } catch (error) {
    return routeError(error, 'Unable to save the email choice.');
  }
}
