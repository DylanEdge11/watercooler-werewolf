import { ensureDatabase } from '../../../../db/migrate';
import { redeemModeratorRecoveryCode } from '../../../../lib/auth/moderators';
import { createModeratorSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../lib/http/rate-limit';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const body = (await request.json()) as { email?: string; recoveryCode?: string; newPassword?: string };
    const email = body.email?.trim().toLowerCase() ?? '';
    await enforceRateLimit(requestRateLimitKey(request, `moderator-recovery:${email}`), 5, 15 * 60_000);
    const moderator = await redeemModeratorRecoveryCode(email, body.recoveryCode ?? '', body.newPassword ?? '');
    if (!moderator) return jsonError('The recovery code or account details were not accepted.', 401);
    await createModeratorSession(moderator.id);
    return Response.json({ ok: true, moderator });
  } catch (error) {
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to recover the moderator account.', 400);
  }
}
