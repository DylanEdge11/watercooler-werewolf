import { authenticateModerator } from '../../../../lib/auth/moderators';
import { ensureDatabase } from '../../../../db/migrate';
import { createModeratorSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../lib/http/rate-limit';

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
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to sign in.', 400);
  }
}
