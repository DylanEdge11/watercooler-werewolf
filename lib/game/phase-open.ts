import { getDb } from '../../db';
import { parseEliminationSchedule, phaseSlots } from './elimination-schedule';
import { validatePhaseOpen } from './phase-policy';
import { changes } from './phase-store';
import type { PhaseActionResult, TransitionActor } from './phase-transitions';
import type { PhaseKind } from './types';
import { notifyPhaseOpened, runAfterResponse } from '../notify/notifications';

/**
 * Opens a Day, Night, or Final ballot.
 *
 * This code moved here unchanged from app/api/games/[gameId]/phases/route.ts so
 * the moderator's Open button and the automatic sweep (lib/game/automation.ts)
 * apply the same rules and the same conditional write. A moderator action
 * records the moderator; an automatic one records no moderator and the
 * SCHEDULER source, and also re-checks inside the write that the game is still
 * in automatic mode, not paused, and has the option on, so a moderator who
 * pauses or unticks at the same moment wins. Invalid requests throw (the route
 * answers 400); a lost race returns a 409 result.
 */
export async function openPhase(gameId: string, actor: TransitionActor, kind: PhaseKind, closesAt: Date): Promise<PhaseActionResult> {
  if (Number.isNaN(closesAt.valueOf()) || closesAt <= new Date()) throw new Error('The phase deadline must be in the future.');
  const db = getDb();
  const game = await db
    .prepare(
      `SELECT status, day_divisor AS dayDivisor, night_divisor AS nightDivisor,
              elimination_schedule_json AS eliminationScheduleJson
       FROM games WHERE id = ? LIMIT 1`,
    )
    .bind(gameId)
    .first<{ status: string; dayDivisor: number; nightDivisor: number; eliminationScheduleJson: string | null }>();
  if (!game) throw new Error('Game not found.');
  const blocking = await db
    .prepare(
      `SELECT id, kind, status, closes_at AS closesAt FROM phases WHERE game_id = ?
       AND status IN ('OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL') LIMIT 1`,
    )
    .bind(gameId)
    .first<{ id: string; kind: PhaseKind; status: string; closesAt: string }>();
  if (blocking) {
    if (blocking.status === 'OPEN' && blocking.kind === kind) {
      return { status: 200, body: { ok: true, idempotent: true, phaseId: blocking.id } };
    }
    throw new Error('Finish the current phase before opening another.');
  }
  const latest = await db
    .prepare('SELECT kind, status FROM phases WHERE game_id = ? ORDER BY sequence DESC LIMIT 1')
    .bind(gameId)
    .first<{ kind: PhaseKind; status: string }>();
  // A final ballot that produced a winner completes the game, so the policy's game-status check covers it.
  const latestEntry = latest ? { kind: latest.kind, status: latest.status } : null;
  const policyError = validatePhaseOpen({ gameStatus: game.status, latestPhase: latestEntry, requestedKind: kind });
  if (policyError) throw new Error(policyError);
  const living = await db
    .prepare("SELECT COUNT(*) AS count FROM seats WHERE game_id = ? AND status = 'CLAIMED' AND alive = 1")
    .bind(gameId)
    .first<{ count: number }>();
  const sequenceRow = await db
    .prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM phases WHERE game_id = ?')
    .bind(gameId)
    .first<{ sequence: number }>();
  const sequence = Number(sequenceRow?.sequence ?? 0) + 1;
  const divisor = kind === 'NIGHT' ? Number(game.nightDivisor) : Number(game.dayDivisor);
  // Days and Nights follow the elimination schedule when the game has one; otherwise the divisor.
  const slots = phaseSlots({
    kind,
    sequence,
    livingPlayers: Number(living?.count ?? 0),
    dayDivisor: Number(game.dayDivisor),
    nightDivisor: Number(game.nightDivisor),
    schedule: parseEliminationSchedule(game.eliminationScheduleJson),
  });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const automatic = actor.source === 'SCHEDULER';
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO phases
         (id, game_id, sequence, kind, status, opens_at, closes_at, slots, divisor_snapshot, version, created_at, updated_at)
         SELECT ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, 1, ?, ?
         WHERE EXISTS (
             SELECT 1 FROM games WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN')
               -- A schedule saved since it was read answers 409, so the slots never use a stale schedule.
               AND elimination_schedule_json IS ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM phases
             WHERE game_id = ? AND status IN ('OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL', 'HUNTER_FINALIZING', 'PUBLISHING')
           )${automatic ? `
           AND EXISTS (
             SELECT 1 FROM games
             WHERE id = ? AND publication_mode = 'AUTOMATIC' AND automation_paused_at IS NULL AND auto_open_next_phase = 1
           )` : ''}`,
      )
      .bind(id, gameId, sequence, kind, now, closesAt.toISOString(), slots, divisor, now, now, gameId, game.eliminationScheduleJson ?? null, gameId, ...(automatic ? [gameId] : [])),
    db
      .prepare(
        `INSERT INTO game_events
         (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
         SELECT ?, ?, ?, 'PHASE_OPENED', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM phases p JOIN games g ON g.id = p.game_id
                       WHERE p.id = ? AND p.status = 'OPEN' AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN'))`,
      )
      .bind(crypto.randomUUID(), gameId, id, actor.moderatorId, JSON.stringify({ kind, slots, closesAt: closesAt.toISOString(), source: actor.source }), now, id),
  ]);
  if (changes(result[0]) !== 1) return { status: 409, error: 'The game or current phase changed before this phase could open. Refresh and try again.' };
  // Players who turned email on and have something to do are told after the response is sent.
  runAfterResponse(() => notifyPhaseOpened(gameId, id));
  return { status: 200, body: { ok: true, phaseId: id, slots } };
}
