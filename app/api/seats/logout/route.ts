import { clearPlayerSession, clearSpectatorSession } from '../../../../lib/auth/session';
import { assertSameOrigin } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    // The dashboard's sign-out button serves players and spectators alike.
    await clearPlayerSession();
    await clearSpectatorSession();
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to sign out.');
  }
}
