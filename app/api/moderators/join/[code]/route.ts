import { ensureDatabase } from '../../../../../db/migrate';
import { lookupSetupLink, redeemSetupLink } from '../../../../../lib/auth/moderator-setup';
import { createModeratorSession } from '../../../../../lib/auth/session';
import { MODERATOR_SETUP_COPY } from '../../../../../lib/game/join-copy';
import { HttpError, jsonError, routeError } from '../../../../../lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '../../../../../lib/http/rate-limit';
import { assertSameOrigin } from '../../../../../lib/http/security';

interface RouteContext {
  params: Promise<{ code: string }>;
}

/** Who a setup link is for, so the page can greet them. 404 for an unknown, used, or expired link. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { code } = await context.params;
    const link = await lookupSetupLink(code);
    if (!link) return jsonError(MODERATOR_SETUP_COPY.invalidLink, 404);
    return Response.json({ ok: true, link: { displayName: link.displayName, gameName: link.gameName } });
  } catch (error) {
    return routeError(error, 'Unable to look up this setup link.');
  }
}

/**
 * Chooses the approved applicant's password. This creates their moderator account, makes them a
 * co-moderator of the game, and signs them in; the response carries their recovery codes once.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { code } = await context.params;
    await enforceRateLimit(requestRateLimitKey(request, `moderator-setup:${code.slice(0, 80)}`), 8, 15 * 60_000);
    const body: unknown = await request.json().catch(() => null);
    const password = typeof (body as { password?: unknown } | null)?.password === 'string' ? (body as { password: string }).password : '';
    if (password.length < 12) return jsonError('Choose a password of at least 12 characters.', 400);
    try {
      const { account, gameName } = await redeemSetupLink(code, password);
      await createModeratorSession(account.id);
      return Response.json({ ok: true, gameName, recoveryCodes: account.recoveryCodes });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return jsonError(MODERATOR_SETUP_COPY.invalidLink, 404);
      throw error;
    }
  } catch (error) {
    return routeError(error, 'Unable to set up the moderator sign-in.');
  }
}
