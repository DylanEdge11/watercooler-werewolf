import { authenticateModerator } from '@/lib/auth/moderators';
import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { purgeExpiredRows } from '@/lib/maintenance';
import { createModeratorSession } from '@/lib/auth/session';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '@/lib/http/rate-limit';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? '';
    // Key parts are capped so a caller cannot create unbounded bucket rows with long inputs.
    await enforceRateLimit(requestRateLimitKey(request, `moderator-login:${email.slice(0, 80)}`), 5, 15 * 60_000);
    const moderator = await authenticateModerator(email, body.password ?? '');
    if (!moderator) return jsonError('Email or password was not accepted.', 401);
    await createModeratorSession(moderator.id);
    // Housekeeping rides on sign-in so it runs even without a scheduler; it never blocks the sign-in.
    await purgeExpiredRows(getDb()).catch((error) => console.error('Expired-row cleanup failed', error));
    return Response.json({ ok: true, moderator });
  } catch (error) {
    return routeError(error, 'Unable to sign in.');
  }
}
