import { createPrimaryModerator, hasModeratorAccount } from '../../../../lib/auth/moderators';
import { createModeratorSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';

export async function GET() {
  return Response.json({ ok: true, needsBootstrap: !(await hasModeratorAccount()) });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { email?: string; password?: string };
    const moderator = await createPrimaryModerator(body.email ?? '', body.password ?? '');
    await createModeratorSession(moderator.id);
    return Response.json({ ok: true, moderator });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to create moderator.', 400);
  }
}

