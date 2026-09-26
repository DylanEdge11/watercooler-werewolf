import { getDb } from '../../../../db';
import { ensureDatabase } from '../../../../db/migrate';
import { sweepAutomation } from '../../../../lib/game/automation-sweep';
import { sweepDuePhases } from '../../../../lib/game/scheduling';
import { jsonError } from '../../../../lib/http/security';

function configuredSchedulerToken(): string | undefined {
  return process.env.CRON_SECRET?.trim() || undefined;
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
    if (!provided || provided !== expected) return jsonError('Scheduler authorization required.', 401);
    await ensureDatabase();
    // Automatic games first: they lock, calculate, and publish through the shared transitions.
    // The deadline sweep then locks any remaining due phase in review-mode games, as before.
    const automation = await sweepAutomation();
    const result = await sweepDuePhases(getDb());
    return Response.json({ ok: true, games: result, lockedPhaseCount: result.reduce((total, game) => total + game.phaseIds.length, 0), automation, ranAt: new Date().toISOString() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to sweep phase deadlines.', 500);
  }
}

export async function GET(request: Request) {
  return sweep(request);
}

export async function POST(request: Request) {
  return sweep(request);
}
