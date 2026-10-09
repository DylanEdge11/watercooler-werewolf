import { ensureDatabase } from '@/db/migrate';
import { jsonError } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import { enforceRateLimit, requestRateLimitKey } from '@/lib/http/rate-limit';
import { unsubscribeByToken } from '@/lib/notify/preferences';

/**
 * Turns off one seat's game email from the link in an email. Unlike other writes it does
 * not check the request's origin: a mail app's one-click unsubscribe (RFC 8058) posts here
 * directly and sends none. The unguessable token in the link is the only credential, and
 * all it can do is switch that one seat's email off. Opening the unsubscribe page never
 * calls this, because mail scanners open links; only the button on that page does.
 */
export async function POST(request: Request) {
  try {
    await ensureDatabase();
    await enforceRateLimit(requestRateLimitKey(request, 'email-unsubscribe'), 60, 60 * 60_000);
    let token = new URL(request.url).searchParams.get('token');
    if (!token) {
      const body = await request.json().catch(() => ({})) as { token?: unknown };
      token = typeof body.token === 'string' ? body.token : null;
    }
    if (!token || !(await unsubscribeByToken(token))) return jsonError('This unsubscribe link is not valid.', 404);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to turn email off.');
  }
}
