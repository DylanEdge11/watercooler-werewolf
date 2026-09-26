import { clearModeratorSession } from '../../../../lib/auth/session';
import { routeError } from '../../../../lib/http/errors';
import { assertSameOrigin } from '../../../../lib/http/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await clearModeratorSession();
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to sign out.');
  }
}
