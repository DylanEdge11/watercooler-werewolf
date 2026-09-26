import { hasModeratorAccount } from '../../../../lib/auth/moderators';
import { ensureDatabase } from '../../../../db/migrate';
import { assertSameOrigin, jsonError } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';

/** Also the test server's health check: 200 once the database is migrated, 503 before. */
export async function GET() {
  try {
    await ensureDatabase();
    return Response.json({ ok: true, needsBootstrap: !(await hasModeratorAccount()) });
  } catch (error) {
    return routeError(error, 'Unable to inspect moderator setup.');
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return jsonError('Primary moderator setup is disabled in the public application. Run `npm run owner:bootstrap` on a trusted operator machine.', 410);
  } catch (error) {
    return routeError(error, 'Unable to inspect moderator setup.');
  }
}
