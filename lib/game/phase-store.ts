import { getDb } from '../../db';
import { canonicalRoleKey, type ActionSubmission, type PlayerState, type RoleKey } from './types';

/**
 * Database reads and small helpers shared by the phases route and the phase
 * transitions (lib/game/phase-transitions.ts). Moved from the route unchanged.
 */

export function overrideIdsFromJson(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { eliminationIds?: unknown };
    return Array.isArray(parsed.eliminationIds)
      ? parsed.eliminationIds.filter((id): id is string => typeof id === 'string')
      : null;
  } catch {
    throw new Error('The stored moderation override is invalid.');
  }
}

export function changes(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}

export async function loadPlayers(gameId: string): Promise<PlayerState[]> {
  const rows = await getDb()
    .prepare(
      `SELECT s.id, s.display_name AS displayName, ra.role_key AS role, s.alive
       FROM seats s JOIN role_assignments ra ON ra.seat_id = s.id AND ra.game_id = s.game_id
       WHERE s.game_id = ? AND s.status = 'CLAIMED' ORDER BY s.id`,
    )
    .bind(gameId)
    .all<{ id: string; displayName: string; role: RoleKey; alive: number }>();
  return rows.results.map((row) => ({ ...row, role: canonicalRoleKey(row.role), alive: Boolean(row.alive) }));
}

export async function loadActions(phaseId: string): Promise<ActionSubmission[]> {
  const rows = await getDb()
    .prepare(
      `SELECT id, actor_seat_id AS actorId, kind, target_ids_json AS targetIdsJson,
              submitted_at AS submittedAt, version
       FROM action_submissions WHERE phase_id = ? AND superseded_at IS NULL ORDER BY submitted_at`,
    )
    .bind(phaseId)
    .all<{ id: string; actorId: string; kind: ActionSubmission['kind']; targetIdsJson: string; submittedAt: string; version: number }>();
  return rows.results.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    kind: row.kind,
    targetIds: JSON.parse(row.targetIdsJson) as string[],
    submittedAt: row.submittedAt,
    version: Number(row.version),
  }));
}

