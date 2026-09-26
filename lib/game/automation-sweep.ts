import { getDb } from '../../db';
import { nextAutomaticStep, type AutomationGame, type AutomationPhase, type AutomaticStep, type PublicationMode } from './automation';
import { runPhaseAction } from './phase-transitions';

export interface AutomationState {
  game: AutomationGame & { hunterWindowMinutes: number };
  phase: AutomationPhase | null;
}

/**
 * One indexed read: the game's automation settings and its current unpublished
 * phase. When nothing is due, this is the sweep's only query on a poll.
 */
export async function loadAutomationState(gameId: string): Promise<AutomationState | null> {
  const row = await getDb()
    .prepare(
      `SELECT g.status AS gameStatus, g.publication_mode AS publicationMode, g.review_window_minutes AS reviewWindowMinutes,
              g.automation_paused_at AS pausedAt, g.hunter_window_minutes AS hunterWindowMinutes,
              p.id AS phaseId, p.status AS phaseStatus, p.closes_at AS closesAt, p.hunter_deadline_at AS hunterDeadlineAt,
              p.updated_at AS phaseUpdatedAt,
              EXISTS (SELECT 1 FROM action_submissions a WHERE a.phase_id = p.id AND a.kind = 'HUNTER_SHOT' AND a.superseded_at IS NULL) AS hunterShotSaved
       FROM games g
       LEFT JOIN phases p ON p.game_id = g.id AND p.status IN ('OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL')
       WHERE g.id = ?
       ORDER BY p.sequence DESC LIMIT 1`,
    )
    .bind(gameId)
    .first<{
      gameStatus: string; publicationMode: PublicationMode; reviewWindowMinutes: number; pausedAt: string | null; hunterWindowMinutes: number;
      phaseId: string | null; phaseStatus: string | null; closesAt: string | null; hunterDeadlineAt: string | null; phaseUpdatedAt: string | null; hunterShotSaved: number | null;
    }>();
  if (!row) return null;
  return {
    game: {
      status: row.gameStatus,
      publicationMode: row.publicationMode,
      reviewWindowMinutes: Number(row.reviewWindowMinutes),
      pausedAt: row.pausedAt,
      hunterWindowMinutes: Number(row.hunterWindowMinutes),
    },
    phase: row.phaseId && row.phaseStatus && row.closesAt && row.phaseUpdatedAt
      ? { id: row.phaseId, status: row.phaseStatus, closesAt: row.closesAt, hunterDeadlineAt: row.hunterDeadlineAt, updatedAt: row.phaseUpdatedAt, hunterShotSaved: Boolean(row.hunterShotSaved) }
      : null,
  };
}

const SCHEDULER = { moderatorId: null, source: 'SCHEDULER' } as const;

/**
 * Applies every automatic step that is due for one game, in order (for
 * example lock and calculate, then publish when the window is zero). Each step
 * goes through the shared transitions and their conditional writes, so a
 * concurrent moderator action or a second sweep makes this one stop cleanly.
 */
export async function advanceGame(gameId: string, now = new Date()): Promise<AutomaticStep['kind'][]> {
  return (await advance(gameId, now)).steps;
}

/** Advances the game and returns the state it last read, so a poll costs one query when nothing is due. */
async function advance(gameId: string, now: Date): Promise<{ steps: AutomaticStep['kind'][]; state: AutomationState | null }> {
  const applied: AutomaticStep['kind'][] = [];
  let state: AutomationState | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    state = await loadAutomationState(gameId);
    // Each step reads the clock afresh: a result calculated a moment ago must count as waiting since then.
    const stepNow = new Date(Math.max(now.valueOf(), Date.now()));
    const step = state ? nextAutomaticStep(state.game, state.phase, stepNow) : null;
    if (!state || !step) break;
    const result = await runPhaseAction(
      gameId,
      state.game,
      SCHEDULER,
      { action: step.kind, phaseId: step.phaseId, skipHunter: step.kind === 'FINALIZE_HUNTER' ? step.skipHunter : undefined },
      step.kind === 'PUBLISH' ? { reviewCutoff: step.reviewCutoff } : undefined,
    );
    // A 409 or an idempotent answer means someone else moved the phase first.
    if (result.status !== 200 || result.body.idempotent) {
      state = await loadAutomationState(gameId);
      break;
    }
    applied.push(step.kind);
  }
  return { steps: applied, state };
}

/**
 * The polling entry point used by the moderator console and the player
 * dashboard. It never throws: a failure is recorded for the Operations panel
 * and the page still loads.
 */
export async function advanceGameSafely(gameId: string, now = new Date()): Promise<AutomationState | null> {
  try {
    return (await advance(gameId, now)).state;
  } catch (error) {
    const state = await loadAutomationState(gameId).catch(() => null);
    try {
      await getDb()
        .prepare(
          `INSERT OR IGNORE INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
           VALUES (?, ?, 'WARNING', 'AUTOMATION', 'An automatic step could not run; it will retry on the next check.', ?, ?)`,
        )
        .bind(automationWarningId(gameId, state?.phase?.id ?? null, now), gameId, JSON.stringify({ phaseId: state?.phase?.id ?? null, error: error instanceof Error ? error.message : 'Unknown error' }), now.toISOString())
        .run();
    } catch {
      // Recording the failure is best effort; the game action itself was not applied.
    }
    return state;
  }
}

/**
 * Every player refresh retries a failed step, so a step that keeps failing
 * would otherwise log a warning on each poll. One id per game, phase, and
 * UTC hour keeps it to a single warning an hour.
 */
export function automationWarningId(gameId: string, phaseId: string | null, now: Date): string {
  return `automation-${gameId}-${phaseId ?? 'none'}-${now.toISOString().slice(0, 13)}`;
}

/** The cron entry point: every running game in automatic mode that is not paused. */
export async function sweepAutomation(now = new Date()): Promise<Array<{ gameId: string; steps: AutomaticStep['kind'][] }>> {
  const games = await getDb()
    .prepare(
      `SELECT id FROM games
       WHERE status IN ('ACTIVE', 'FINAL_SHOWDOWN') AND publication_mode = 'AUTOMATIC' AND automation_paused_at IS NULL`,
    )
    .all<{ id: string }>();
  const results: Array<{ gameId: string; steps: AutomaticStep['kind'][] }> = [];
  for (const game of games.results) {
    try {
      const steps = await advanceGame(game.id, now);
      if (steps.length) results.push({ gameId: game.id, steps });
    } catch {
      // One game's failure must not stop the others; the next poll or sweep retries it.
      await advanceGameSafely(game.id, now);
    }
  }
  return results;
}
