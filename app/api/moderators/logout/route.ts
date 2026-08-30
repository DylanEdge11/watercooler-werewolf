import { clearModeratorSession } from '../../../../lib/auth/session';
import { assertSameOrigin } from '../../../../lib/http/security';

export async function POST(request: Request) {
  assertSameOrigin(request);
  await clearModeratorSession();
  return Response.json({ ok: true });
}

