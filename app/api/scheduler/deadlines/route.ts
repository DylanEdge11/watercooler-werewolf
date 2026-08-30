import { env } from 'cloudflare:workers';
import { getD1 } from '../../../../db';
import { ensureDatabase } from '../../../../db/migrate';
import { sweepDuePhases } from '../../../../lib/game/scheduling';
import { jsonError } from '../../../../lib/http/security';

function configuredSchedulerToken(): string | undefined {
  return (env as Cloudflare.Env & { WATERCOOLER_SCHEDULER_TOKEN?: string }).WATERCOOLER_SCHEDULER_TOKEN;
}

function providedSchedulerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization') ?? '';
  if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  return request.headers.get('x-watercooler-scheduler-token')?.trim() || undefined;
}

/**
 * Cron-compatible deadline sweep. Configure WATERCOOLER_SCHEDULER_TOKEN in
 * the hosting environment and invoke this endpoint once per minute from the
 * host scheduler. The moderator Operations panel remains a manual/polling
 * fallback for private pilots where no scheduler secret has been configured.
 */
export async function POST(request: Request) {
  try {
    const expected = configuredSchedulerToken();
    const provided = providedSchedulerToken(request);
    if (!expected) return jsonError('Deadline scheduler is not configured.', 503);
    if (!provided || provided !== expected) return jsonError('Scheduler authorization required.', 401);
    await ensureDatabase();
    const result = await sweepDuePhases(getD1());
    return Response.json({ ok: true, games: result, lockedPhaseCount: result.reduce((total, game) => total + game.phaseIds.length, 0), ranAt: new Date().toISOString() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to sweep phase deadlines.', 500);
  }
}
