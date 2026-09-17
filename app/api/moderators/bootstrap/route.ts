import { hasModeratorAccount } from '../../../../lib/auth/moderators';
import { ensureDatabase } from '../../../../db/migrate';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';

export async function GET() {
  await ensureDatabase();
  const needsBootstrap = !(await hasModeratorAccount());
  return Response.json({
    ok: true,
    needsBootstrap,
    operatorBootstrapRequired: needsBootstrap,
  });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return jsonError('Primary moderator setup is disabled in the public application. Run `npm run owner:bootstrap` on a trusted operator machine.', 410);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to inspect moderator setup.', 400);
  }
}
