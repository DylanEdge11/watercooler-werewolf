import { authenticateModerator } from '../../../../lib/auth/moderators';
import { ensureDatabase } from '../../../../db/migrate';
import { createModeratorSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../lib/http/rate-limit';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? '';
    await enforceRateLimit(requestRateLimitKey(request, `moderator-login:${email}`), 5, 15 * 60_000);
    const moderator = await authenticateModerator(email, body.password ?? '');
    if (!moderator) return jsonError('Email or password was not accepted.', 401);
    await createModeratorSession(moderator.id);
    return Response.json({ ok: true, moderator });
  } catch (error) {
    return routeError(error, 'Unable to sign in.');
  }
}
