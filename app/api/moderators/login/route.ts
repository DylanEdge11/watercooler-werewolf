import { authenticateModerator } from '../../../../lib/auth/moderators';
import { createModeratorSession } from '../../../../lib/auth/session';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { email?: string; password?: string };
    const moderator = await authenticateModerator(body.email ?? '', body.password ?? '');
    if (!moderator) return jsonError('Email or password was not accepted.', 401);
    await createModeratorSession(moderator.id);
    return Response.json({ ok: true, moderator });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to sign in.', 400);
  }
}

