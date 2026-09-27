import { clearPlayerSession } from '../../../../lib/auth/session';
import { assertSameOrigin } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await clearPlayerSession();
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to sign out.');
  }
}
