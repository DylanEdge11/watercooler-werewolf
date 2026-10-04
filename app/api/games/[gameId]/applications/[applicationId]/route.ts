import { ensureDatabase } from '../../../../../../db/migrate';
import { requireGameOwner } from '../../../../../../lib/auth/authorization';
import { decideApplication } from '../../../../../../lib/auth/application-approval';
import { routeError } from '../../../../../../lib/http/errors';
import { assertSameOrigin } from '../../../../../../lib/http/security';

interface RouteContext {
  params: Promise<{ gameId: string; applicationId: string }>;
}

const DECISIONS = ['APPROVE', 'DECLINE', 'RECONSIDER'] as const;

/**
 * The owner approves, declines, or reconsiders one application. Approving an applicant with no
 * account issues a one-time setup link (emailed when the site can send email, and returned once
 * so the owner can pass it on); approving one who already has an account adds them at once.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId, applicationId } = await context.params;
    const owner = await requireGameOwner(gameId, 'approve moderator applications');
    const body: unknown = await request.json().catch(() => null);
    const decision = (body && typeof body === 'object' ? (body as { decision?: unknown }).decision : undefined);
    if (typeof decision !== 'string' || !(DECISIONS as readonly string[]).includes(decision)) throw new Error('Choose APPROVE, DECLINE, or RECONSIDER.');
    const outcome = await decideApplication({
      gameId,
      applicationId,
      ownerId: owner.id,
      decision: decision as (typeof DECISIONS)[number],
      origin: new URL(request.url).origin,
    });
    return Response.json({ ok: true, ...outcome });
  } catch (error) {
    return routeError(error, 'Unable to update the application.');
  }
}
