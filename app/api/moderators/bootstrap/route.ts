import { env } from 'cloudflare:workers';
import { createPrimaryModerator, hasModeratorAccount } from '../../../../lib/auth/moderators';
import { ensureDatabase } from '../../../../db/migrate';
import { createModeratorSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../lib/http/rate-limit';
import { isConfiguredSiteOwner } from '../../../../lib/auth/site-owner';

function ownerEmail(): string | undefined {
  return (env as Cloudflare.Env & { WATERCOOLER_OWNER_EMAIL?: string }).WATERCOOLER_OWNER_EMAIL;
}

export async function GET(request: Request) {
  const needsBootstrap = !(await hasModeratorAccount());
  return Response.json({
    ok: true,
    needsBootstrap,
    canBootstrap: !needsBootstrap || isConfiguredSiteOwner(request, ownerEmail()),
  });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    if (!(await hasModeratorAccount()) && !isConfiguredSiteOwner(request, ownerEmail())) {
      return jsonError('Primary moderator setup requires verification by the configured site owner.', 403);
    }
    const body = (await request.json()) as { email?: string; password?: string };
    await enforceRateLimit(requestRateLimitKey(request, `moderator-bootstrap:${body.email?.trim().toLowerCase() ?? ''}`), 3, 15 * 60_000);
    const moderator = await createPrimaryModerator(body.email ?? '', body.password ?? '');
    await createModeratorSession(moderator.id);
    // Keep recovery codes at the response boundary. The account record never
    // contains the plaintext values and the client should not depend on a
    // nested shape that differs from co-moderator creation.
    const { recoveryCodes, ...account } = moderator;
    return Response.json({ ok: true, moderator: account, recoveryCodes });
  } catch (error) {
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to create moderator.', 400);
  }
}
