import { getDb } from '../../db';
import { loadRoster, parseTargetIds, RUN_BOUNDARY } from '../player/dashboard-data';
import { buildModeratorChoices, type PhaseChoices } from './moderator-choices';
import type { ActionKind, PhaseKind } from './types';

/**
 * Every phase of the current run with each player's current choice in it,
 * including open phases and Night actions. Moderator console only: it names
 * every role and every private target.
 */
export async function loadModeratorChoices(gameId: string): Promise<PhaseChoices[]> {
  const db = getDb();
  const [roster, phaseRows, actionRows] = await Promise.all([
    loadRoster(gameId),
    db
      .prepare(
        `SELECT id, sequence, kind, status FROM phases
         WHERE game_id = ? AND created_at > COALESCE(${RUN_BOUNDARY}, '')
         ORDER BY sequence DESC`,
      )
      .bind(gameId, gameId)
      .all<{ id: string; sequence: number; kind: PhaseKind; status: string }>(),
    // A resubmitted choice supersedes the earlier one, so these are the choices that count.
    db
      .prepare(
        `SELECT a.phase_id AS phaseId, a.actor_seat_id AS actorId, a.kind, a.target_ids_json AS targetIdsJson
         FROM action_submissions a JOIN phases p ON p.id = a.phase_id
         WHERE p.game_id = ? AND a.superseded_at IS NULL
           AND p.created_at > COALESCE(${RUN_BOUNDARY}, '')
         ORDER BY a.submitted_at`,
      )
      .bind(gameId, gameId)
      .all<{ phaseId: string; actorId: string; kind: ActionKind; targetIdsJson: string }>(),
  ]);
  return buildModeratorChoices({
    seats: roster,
    phases: phaseRows.results.map((phase) => ({ ...phase, sequence: Number(phase.sequence) })),
    actions: actionRows.results.map((action) => ({ ...action, targetIds: parseTargetIds(action.targetIdsJson) })),
  });
}
