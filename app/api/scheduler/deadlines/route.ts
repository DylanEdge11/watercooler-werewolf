import { createHash, timingSafeEqual } from 'node:crypto';
import { getDb } from '../../../../db';
import { ensureDatabase } from '../../../../db/migrate';
import { sweepAutomation } from '../../../../lib/game/automation-sweep';
import { sweepDuePhases } from '../../../../lib/game/scheduling';
import { purgeExpiredRows } from '../../../../lib/maintenance';
import { jsonError } from '../../../../lib/http/security';
import { routeError } from '../../../../lib/http/errors';

function configuredSchedulerToken(): string | undefined {
  return process.env.CRON_SECRET?.trim() || undefined;
}

/** Compares digests so the time taken never depends on how much of the secret matched. */
function sameSecret(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

function providedSchedulerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() || undefined : undefined;
}

/**
 * Optional cron-compatible sweep. Vercel sends a GET request and the
 * configured CRON_SECRET as a Bearer token. The game never depends on it:
 * the moderator console and the player dashboard apply due automatic steps
 * on every visit, and this route only makes that happen without a visit.
 */
async function sweep(request: Request) {
  try {
    const expected = configuredSchedulerToken();
    const provided = providedSchedulerToken(request);
    if (!expected) return jsonError('Deadline scheduler is not configured.', 503);
    if (!provided || !sameSecret(provided, expected)) return jsonError('Scheduler authorization required.', 401);
    await ensureDatabase();
    // Automatic games first: they lock, calculate, and publish through the shared transitions.
    // The deadline sweep then locks any remaining due phase in review-mode games, as before.
    const automation = await sweepAutomation();
    const result = await sweepDuePhases(getDb());
    // Housekeeping never fails the sweep.
    const purged = await purgeExpiredRows(getDb()).catch((error) => { console.error('Expired-row cleanup failed', error); return null; });
    return Response.json({ ok: true, games: result, lockedPhaseCount: result.reduce((total, game) => total + game.phaseIds.length, 0), automation, purged, ranAt: new Date().toISOString() });
  } catch (error) {
    return routeError(error, 'Unable to sweep phase deadlines.');
  }
}

export async function GET(request: Request) {
  return sweep(request);
}

export async function POST(request: Request) {
  return sweep(request);
}
