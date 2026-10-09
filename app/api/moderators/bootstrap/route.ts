import { hasModeratorAccount } from '../../../../lib/auth/moderators';
import { ensureDatabase } from '../../../../db/migrate';
import { routeError } from '../../../../lib/http/errors';

/**
 * Also the test server's health check: 200 once the database is migrated, 503 before.
 * There is deliberately no POST: the first moderator is created only by `npm run owner:bootstrap`.
 */
export async function GET() {
  try {
    await ensureDatabase();
    return Response.json({ ok: true, needsBootstrap: !(await hasModeratorAccount()) });
  } catch (error) {
    return routeError(error, 'Unable to inspect moderator setup.');
  }
}
