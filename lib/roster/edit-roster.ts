import { getDb, type PreparedStatement, type RunResult } from '../../db';
import type { SqlValue } from '../../db/contracts';
import { ROLE_CATALOG } from '../game/catalog';
import { adjustCompositionForRosterChange, canEditRoster } from '../game/roster-edit';
import { canonicalRoleKey, ROLE_KEYS, type RoleComposition, type RoleKey } from '../game/types';
import { HttpError } from '../http/errors';

export class RosterEditError extends HttpError {
  constructor(message: string, status: number) {
    super(status, message);
  }
}

export interface RosterSnapshot {
  setupRevision: number;
  seatCount: number;
  composition: RoleComposition;
}

/** Reads what a single-seat edit needs, refusing unless the roster is editable. */
export async function loadEditableRoster(gameId: string): Promise<RosterSnapshot> {
  const db = getDb();
  const game = await db
    .prepare(
      `SELECT status, setup_revision AS setupRevision,
              EXISTS (SELECT 1 FROM role_assignments WHERE game_id = games.id) AS released,
              (SELECT COUNT(*) FROM seats WHERE game_id = games.id AND status != 'REMOVED') AS seatCount
       FROM games WHERE id = ? LIMIT 1`,
    )
    .bind(gameId)
    .first<{ status: string; setupRevision: number; released: number; seatCount: number }>();
  if (!game) throw new RosterEditError('Game not found.', 404);
  const decision = canEditRoster(game.status, Boolean(Number(game.released)));
  if (!decision.allowed) throw new RosterEditError(decision.error, 409);
  const rows = await db
    .prepare('SELECT role_key AS roleKey, count FROM game_role_counts WHERE game_id = ?')
    .bind(gameId)
    .all<{ roleKey: RoleKey; count: number }>();
  const composition = Object.fromEntries(ROLE_KEYS.map((role) => [role, 0])) as RoleComposition;
  for (const row of rows.results) composition[canonicalRoleKey(row.roleKey)] = Number(row.count);
  return { setupRevision: Number(game.setupRevision ?? 1), seatCount: Number(game.seatCount), composition };
}

/**
 * Applies one seat change and the matching role counts in a single transaction.
 * The first statement claims the setup revision only if the game, roster size,
 * and `extraClaimCondition` are still as read; every later statement requires
 * that claimed revision, so a concurrent edit, claim, randomize, or release
 * leaves nothing changed and the caller gets a 409.
 */
export async function applySeatChange(options: {
  gameId: string;
  moderatorId: string;
  snapshot: RosterSnapshot;
  delta: 1 | -1;
  eventType: 'SEAT_ADDED' | 'SEAT_REMOVED';
  eventPayload: Record<string, unknown>;
  extraClaimCondition?: { sql: string; args: SqlValue[] };
  seatStatements: (guard: string, guardArgs: SqlValue[]) => PreparedStatement[];
}): Promise<{ composition: RoleComposition; resetToPreset: boolean; playerCount: number }> {
  const db = getDb();
  const { gameId, snapshot, delta } = options;
  const playerCount = snapshot.seatCount + delta;
  const { composition, resetToPreset } = adjustCompositionForRosterChange(snapshot.composition, playerCount, delta);
  const now = new Date().toISOString();
  const nextRevision = snapshot.setupRevision + 1;
  const guard = `EXISTS (
    SELECT 1 FROM games g
    WHERE g.id = ? AND g.setup_revision = ? AND g.status IN ('DRAFT', 'REGISTRATION')
      AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = g.id)
  )`;
  const guardArgs: SqlValue[] = [gameId, nextRevision];
  const extra = options.extraClaimCondition;
  const statements = [
    db
      .prepare(
        `UPDATE games SET setup_revision = setup_revision + 1, updated_at = ?
         WHERE id = ? AND setup_revision = ? AND status IN ('DRAFT', 'REGISTRATION')
           AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)
           AND (SELECT COUNT(*) FROM seats s WHERE s.game_id = games.id AND s.status != 'REMOVED') = ?
           ${extra ? `AND ${extra.sql}` : ''}`,
      )
      .bind(now, gameId, snapshot.setupRevision, snapshot.seatCount, ...(extra?.args ?? [])),
    ...options.seatStatements(guard, guardArgs),
    // Any earlier preview was for a different roster.
    db.prepare(`DELETE FROM assignment_batches WHERE game_id = ? AND ${guard}`).bind(gameId, ...guardArgs),
    db.prepare(`DELETE FROM game_role_counts WHERE game_id = ? AND ${guard}`).bind(gameId, ...guardArgs),
    ...ROLE_KEYS.map((role) =>
      db
        .prepare(
          `INSERT INTO game_role_counts (game_id, role_key, count, power_snapshot)
           SELECT ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(gameId, role, composition[role], ROLE_CATALOG[role].power, ...guardArgs),
    ),
    db
      .prepare(
        `INSERT INTO game_events (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      )
      .bind(
        crypto.randomUUID(),
        gameId,
        options.eventType,
        options.moderatorId,
        JSON.stringify({ ...options.eventPayload, playerCount, composition, compositionReset: resetToPreset, setupRevision: nextRevision }),
        now,
        ...guardArgs,
      ),
  ];
  const result = await db.batch(statements);
  if (Number((result[0] as RunResult | undefined)?.meta?.changes ?? 0) !== 1) {
    throw new RosterEditError('The roster changed while you were editing it. Refresh and try again.', 409);
  }
  return { composition, resetToPreset, playerCount };
}
