import { getDb } from '../../db';
import { buildRecap, type GameRecap } from './recap';
import { canonicalRoleKey, type PhaseKind, type RoleKey } from './types';

export type RecapLoadResult =
  | { ok: true; gameName: string; recap: GameRecap }
  | { ok: false; status: 404 | 403; error: string };

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Loads everything the recap needs for one game. Only COMPLETED games have a
 * recap; a stopped or running game returns 403. Events before the latest reset
 * or restore belong to an earlier run and are left out.
 */
export async function loadGameRecap(gameId: string): Promise<RecapLoadResult> {
  const db = getDb();
  const game = await db
    .prepare('SELECT name, status FROM games WHERE id = ? LIMIT 1')
    .bind(gameId)
    .first<{ name: string; status: string }>();
  if (!game) return { ok: false, status: 404, error: 'Game not found.' };
  if (game.status !== 'COMPLETED') {
    return { ok: false, status: 403, error: 'The recap opens when the game is complete.' };
  }

  const boundary = (await db
    .prepare(
      `SELECT MAX(created_at) AS createdAt FROM game_events
       WHERE game_id = ? AND event_type IN ('GAME_RESET', 'GAME_RESTORED')`,
    )
    .bind(gameId)
    .first<{ createdAt: string | null }>())?.createdAt ?? '';

  const [rosterRows, phaseRows, pairingRows, completedRow, ballotRows] = await Promise.all([
    db
      .prepare(
        `SELECT s.id, s.display_name AS displayName, s.alive, ra.role_key AS role
         FROM seats s JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
         WHERE s.game_id = ? AND s.status = 'CLAIMED'`,
      )
      .bind(gameId)
      .all<{ id: string; displayName: string; alive: number; role: RoleKey }>(),
    db
      .prepare(
        `SELECT ge.phase_id AS phaseId, p.sequence, p.kind, ge.payload_json AS payloadJson
         FROM game_events ge JOIN phases p ON p.id = ge.phase_id
         WHERE ge.game_id = ? AND ge.event_type = 'PHASE_PUBLISHED' AND ge.created_at > ?
         ORDER BY p.sequence ASC`,
      )
      .bind(gameId, boundary)
      .all<{ phaseId: string; sequence: number; kind: PhaseKind; payloadJson: string }>(),
    db
      .prepare(
        `SELECT phase_id AS phaseId, payload_json AS payloadJson FROM game_events
         WHERE game_id = ? AND event_type = 'CUPID_PAIR_SET' AND created_at > ?
         ORDER BY created_at ASC`,
      )
      .bind(gameId, boundary)
      .all<{ phaseId: string | null; payloadJson: string }>(),
    db
      .prepare(
        `SELECT payload_json AS payloadJson FROM game_events
         WHERE game_id = ? AND event_type = 'GAME_COMPLETED' AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(gameId, boundary)
      .first<{ payloadJson: string }>(),
    db
      .prepare(
        `SELECT p.id AS phaseId, a.actor_seat_id AS actorId, a.target_ids_json AS targetIdsJson
         FROM phases p JOIN action_submissions a ON a.phase_id = p.id
         WHERE p.game_id = ? AND p.status = 'PUBLISHED' AND p.kind IN ('DAY', 'FINAL_BALLOT')
           AND a.kind = 'DAY_VOTE' AND a.superseded_at IS NULL AND p.created_at > ?
         ORDER BY p.sequence ASC, a.submitted_at ASC, a.id ASC`,
      )
      .bind(gameId, boundary)
      .all<{ phaseId: string; actorId: string; targetIdsJson: string }>(),
  ]);

  const winnerValue = (parseJson(completedRow?.payloadJson) as { winner?: unknown } | null)?.winner;
  const recap = buildRecap({
    winner: winnerValue === 'VILLAGE' || winnerValue === 'WEREWOLF' ? winnerValue : null,
    roster: rosterRows.results.map((seat) => ({
      id: seat.id,
      displayName: seat.displayName,
      role: canonicalRoleKey(seat.role),
      alive: Boolean(seat.alive),
    })),
    phases: phaseRows.results.map((row) => ({
      phaseId: row.phaseId,
      sequence: Number(row.sequence),
      kind: row.kind,
      payload: parseJson(row.payloadJson),
    })),
    pairings: pairingRows.results.flatMap((row) => {
      const pair = parseJson(row.payloadJson) as { cupidId?: unknown; playerIds?: unknown } | null;
      return pair && typeof pair.cupidId === 'string' && Array.isArray(pair.playerIds)
        ? [{ phaseId: row.phaseId, cupidId: pair.cupidId, playerIds: pair.playerIds.filter((id): id is string => typeof id === 'string') }]
        : [];
    }),
    ballots: ballotRows.results.map((row) => {
      const targets = parseJson(row.targetIdsJson);
      return {
        phaseId: row.phaseId,
        actorId: row.actorId,
        targetIds: Array.isArray(targets) ? targets.filter((id): id is string => typeof id === 'string') : [],
      };
    }),
  });
  return { ok: true, gameName: game.name, recap };
}
