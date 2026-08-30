import { clearPlayerSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await clearPlayerSession();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to sign out.', 400);
  }
}
