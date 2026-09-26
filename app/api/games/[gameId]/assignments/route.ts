import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { validateComposition, scoreComposition } from '../../../../../lib/game/balance';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../../../lib/game/player-count';
import { createAssignmentPreview, fingerprintComposition, fingerprintRoster } from '../../../../../lib/game/assignment';
import { ROLE_CATALOG } from '../../../../../lib/game/catalog';
import { createSecureRandomRolls } from '../../../../../lib/game/random';
import { canonicalRoleKey, ROLE_KEYS, type RoleComposition, type RoleKey } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { roomSyncStatements } from '../../../../../lib/chat/rooms';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

interface AssignmentRow {
  seatId: string;
  role: RoleKey;
}

interface GameSetupRow {
  status: string;
  setupRevision: number;
}

function changes(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}

const SETUP_STATUSES = "'DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'";

async function loadComposition(gameId: string): Promise<RoleComposition> {
  const rows = await getDb()
    .prepare('SELECT role_key AS roleKey, count FROM game_role_counts WHERE game_id = ?')
    .bind(gameId)
    .all<{ roleKey: RoleKey; count: number }>();
  const composition = Object.fromEntries(ROLE_KEYS.map((role) => [role, 0])) as RoleComposition;
  for (const row of rows.results) composition[canonicalRoleKey(row.roleKey)] = Number(row.count);
  return composition;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const db = getDb();
    const game = await getDb()
      .prepare('SELECT status, setup_revision AS setupRevision FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<GameSetupRow>();
    if (!game) throw new HttpError(404, 'Game not found.');
    const composition = await loadComposition(gameId);
    const roster = await db
      .prepare(
        `SELECT id, display_name AS displayName, status
         FROM seats WHERE game_id = ? AND status != 'REMOVED'
         ORDER BY display_name COLLATE NOCASE`,
      )
      .bind(gameId)
      .all();
    const batches = await db
      .prepare(
          `SELECT id, revision, setup_revision AS setupRevision,
                  roster_fingerprint AS rosterFingerprint, composition_fingerprint AS compositionFingerprint,
                  assignments_json AS assignmentsJson,
                 random_evidence_hash AS randomEvidenceHash, released_at AS releasedAt, created_at AS createdAt
         FROM assignment_batches WHERE game_id = ? ORDER BY revision DESC`,
      )
      .bind(gameId)
      .all();
    return Response.json({
      ok: true,
      game: { status: game.status, setupRevision: Number(game.setupRevision ?? 1) },
      composition,
      balance: scoreComposition(composition),
      roster: roster.results,
      batches: batches.results.map((batch) => ({
        ...batch,
        assignments: (JSON.parse(String(batch.assignmentsJson)) as AssignmentRow[]).map((assignment) => ({
          ...assignment,
          role: canonicalRoleKey(assignment.role),
        })),
        assignmentsJson: undefined,
      })),
    });
  } catch (error) {
    return routeError(error, 'Unable to load assignments.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as {
      action?: 'SAVE_COMPOSITION' | 'PREVIEW' | 'RELEASE';
      composition?: Partial<RoleComposition>;
      batchId?: string;
    };
    const db = getDb();
    const game = await db
      .prepare('SELECT status, setup_revision AS setupRevision FROM games WHERE id = ? LIMIT 1')
      .bind(gameId)
      .first<GameSetupRow>();
    if (!game) throw new HttpError(404, 'Game not found.');
    const roster = await db
      .prepare("SELECT id, status FROM seats WHERE game_id = ? AND status != 'REMOVED' ORDER BY id")
      .bind(gameId)
      .all<{ id: string; status: string }>();
    if (roster.results.length < MIN_PLAYERS || roster.results.length > MAX_PLAYERS) {
      throw new Error(`A valid ${MIN_PLAYERS}–${MAX_PLAYERS} player roster is required.`);
    }
    const releasedCount = await db
      .prepare('SELECT COUNT(*) AS count FROM role_assignments WHERE game_id = ?')
      .bind(gameId)
      .first<{ count: number }>();
    const rolesAreReleased = Number(releasedCount?.count ?? 0) > 0;

    if (body.action === 'SAVE_COMPOSITION') {
      if (rolesAreReleased) throw new Error('Role composition is locked after roles are released.');
      if (!['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(game.status)) {
        throw new Error('Composition can only be changed during setup. Reset or restore the game before preparing it again.');
      }
      const rawComposition = body.composition as (Partial<Record<RoleKey | 'DOCTOR', unknown>> | undefined);
      const composition = Object.fromEntries(
        ROLE_KEYS.map((role) => [role, Number(rawComposition?.[role] ?? (role === 'BODYGUARD' ? rawComposition?.DOCTOR : 0) ?? 0)]),
      ) as RoleComposition;
      const validation = validateComposition(composition, roster.results.length);
      if (!validation.valid) return Response.json({ ok: false, errors: validation.errors }, { status: 400 });
      const expectedRevision = Number(game.setupRevision ?? 1);
      const nextRevision = expectedRevision + 1;
      const now = new Date().toISOString();
      const setupGuard = `EXISTS (
        SELECT 1 FROM games g
        WHERE g.id = ? AND g.setup_revision = ? AND g.status = 'COMPOSITION_SAVING'
          AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = g.id)
      )`;
      const result = await db.batch([
        // This is the setup write claim. Every subsequent statement checks the
        // incremented revision, so Stop/release cannot be partially bypassed.
        db
          .prepare(
            `UPDATE games SET status = 'COMPOSITION_SAVING', setup_revision = setup_revision + 1, updated_at = ?
             WHERE id = ? AND setup_revision = ? AND status IN (${SETUP_STATUSES})
               AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
          )
          .bind(now, gameId, expectedRevision),
        db.prepare(`DELETE FROM assignment_batches WHERE game_id = ? AND ${setupGuard}`).bind(gameId, gameId, nextRevision),
        db.prepare(`DELETE FROM game_role_counts WHERE game_id = ? AND ${setupGuard}`).bind(gameId, gameId, nextRevision),
        ...ROLE_KEYS.map((role) =>
          db
            .prepare(
              `INSERT INTO game_role_counts (game_id, role_key, count, power_snapshot)
               SELECT ?, ?, ?, ? WHERE ${setupGuard}`,
            )
            .bind(gameId, role, composition[role], ROLE_CATALOG[role].power, gameId, nextRevision),
        ),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, 'COMPOSITION_UPDATED', ?, ?, ? WHERE ${setupGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ composition, setupRevision: nextRevision }), now, gameId, nextRevision),
        db
          .prepare(
            `UPDATE games SET status = 'REGISTRATION', updated_at = ?
             WHERE id = ? AND setup_revision = ? AND status = 'COMPOSITION_SAVING'
               AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
          )
          .bind(now, gameId, nextRevision),
      ]);
      if (changes(result[0]) !== 1) {
        return jsonError('Setup changed while the composition was being saved. Refresh before trying again.', 409);
      }
      return Response.json({ ok: true, composition, balance: scoreComposition(composition), setupRevision: nextRevision, previewInvalidated: true });
    }

    if (body.action === 'PREVIEW') {
      if (rolesAreReleased) throw new Error('Assignments are locked after roles are released.');
      if (!['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(game.status)) {
        throw new Error('Assignments can only be prepared during setup. Reset or restore the game before preparing them again.');
      }
      if (roster.results.some((seat) => seat.status !== 'CLAIMED')) {
        throw new Error('Every invited player must claim their seat before roles are randomized.');
      }
      const composition = await loadComposition(gameId);
      const seatIds = roster.results.map((seat) => seat.id);
      const rosterFingerprint = await fingerprintRoster(seatIds);
      const compositionFingerprint = await fingerprintComposition(composition);
      const setupRevision = Number(game.setupRevision ?? 1);
      const preview = await createAssignmentPreview(
        seatIds,
        composition,
        createSecureRandomRolls(Math.max(0, seatIds.length - 1)),
      );
      const currentRevision = await db
        .prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM assignment_batches WHERE game_id = ?')
        .bind(gameId)
        .first<{ revision: number }>();
      const batchId = crypto.randomUUID();
      const revision = Number(currentRevision?.revision ?? 0) + 1;
      const now = new Date().toISOString();
      const previewGuard = `EXISTS (
        SELECT 1 FROM games g
        WHERE g.id = ? AND g.setup_revision = ? AND g.status = 'ASSIGNMENT_PREVIEWING'
          AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = g.id)
      )`;
      const result = await db.batch([
        db
          .prepare(
            `UPDATE games SET status = 'ASSIGNMENT_PREVIEWING', updated_at = ?
             WHERE id = ? AND setup_revision = ? AND status IN (${SETUP_STATUSES})
               AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)`,
          )
          .bind(now, gameId, setupRevision),
        db
          .prepare(
            `INSERT INTO assignment_batches
             (id, game_id, revision, setup_revision, roster_fingerprint, composition_fingerprint,
              assignments_json, random_evidence_hash, created_by_moderator_id, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${previewGuard}`,
          )
          .bind(
            batchId,
            gameId,
            revision,
            setupRevision,
            rosterFingerprint,
            compositionFingerprint,
            JSON.stringify(preview.assignments),
            preview.evidenceHash,
            moderator.id,
            now,
            gameId,
            setupRevision,
          ),
        db
          .prepare(
            `UPDATE games SET status = 'ASSIGNMENT_PREVIEW', updated_at = ?
             WHERE id = ? AND setup_revision = ? AND status = 'ASSIGNMENT_PREVIEWING'
               AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)
               AND EXISTS (SELECT 1 FROM assignment_batches b WHERE b.id = ? AND b.game_id = games.id AND b.released_at IS NULL)`,
          )
          .bind(now, gameId, setupRevision, batchId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, 'ASSIGNMENT_PREVIEWED', ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM assignment_batches b WHERE b.id = ? AND b.game_id = ? AND b.released_at IS NULL)
               AND EXISTS (SELECT 1 FROM games WHERE id = ? AND setup_revision = ? AND status IN ('ASSIGNMENT_PREVIEWING', 'ASSIGNMENT_PREVIEW'))`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ batchId, revision, setupRevision, rosterFingerprint, compositionFingerprint }), now, batchId, gameId, gameId, setupRevision),
      ]);
      if (changes(result[0]) !== 1) {
        return jsonError('Setup changed while the assignment preview was being created. Refresh and randomize again.', 409);
      }
      return Response.json({ ok: true, batchId, revision, setupRevision, rosterFingerprint, compositionFingerprint, ...preview });
    }

    if (body.action === 'RELEASE') {
      if (!body.batchId) throw new Error('Choose a randomized batch to release.');
      if (game.status === 'STOPPED') throw new Error('This game is stopped. Reset or restore it before releasing roles.');
      if (game.status !== 'ASSIGNMENT_PREVIEW') throw new Error('Release is available only after a current assignment preview.');
      if (rolesAreReleased) throw new Error('Roles have already been released for this game.');
      const batch = await db
        .prepare(
          `SELECT assignments_json AS assignmentsJson, setup_revision AS setupRevision,
                  roster_fingerprint AS rosterFingerprint, composition_fingerprint AS compositionFingerprint
           FROM assignment_batches
           WHERE id = ? AND game_id = ? AND released_at IS NULL LIMIT 1`,
        )
        .bind(body.batchId, gameId)
        .first<{ assignmentsJson: string; setupRevision: number; rosterFingerprint: string; compositionFingerprint: string }>();
      if (!batch) throw new Error('That assignment batch is not available.');
      let assignments: AssignmentRow[];
      try {
        assignments = JSON.parse(batch.assignmentsJson) as AssignmentRow[];
      } catch {
        throw new Error('That assignment batch is not valid. Create a new preview.');
      }
      if (assignments.length !== roster.results.length) throw new Error('Assignment batch does not match the roster.');
      if (roster.results.some((seat) => seat.status !== 'CLAIMED')) throw new Error('Every invited player must claim their seat before roles are released.');
      const composition = await loadComposition(gameId);
      const setupRevision = Number(game.setupRevision ?? 1);
      const rosterFingerprint = await fingerprintRoster(roster.results.map((seat) => seat.id));
      const compositionFingerprint = await fingerprintComposition(composition);
      if (
        Number(batch.setupRevision) !== setupRevision
        || batch.rosterFingerprint !== rosterFingerprint
        || batch.compositionFingerprint !== compositionFingerprint
      ) {
        throw new Error('This assignment preview is stale because the roster or composition changed. Create a new preview.');
      }
      const assignmentIds = assignments.map((assignment) => assignment.seatId);
      if (new Set(assignmentIds).size !== assignmentIds.length) {
        throw new Error('Assignment batch does not match the current roster. Create a new preview.');
      }
      const rosterIds = new Set(roster.results.map((seat) => seat.id));
      const roleCounts = Object.fromEntries(ROLE_KEYS.map((role) => [role, 0])) as RoleComposition;
      for (const assignment of assignments) {
        if (!rosterIds.has(assignment.seatId) || !ROLE_KEYS.includes(canonicalRoleKey(String(assignment.role)))) {
          throw new Error('Assignment batch contains a player or role outside the current setup. Create a new preview.');
        }
        roleCounts[canonicalRoleKey(String(assignment.role))] += 1;
      }
      if (ROLE_KEYS.some((role) => roleCounts[role] !== composition[role])) {
        throw new Error('Assignment batch does not match the saved composition. Create a new preview.');
      }
      const now = new Date().toISOString();
      const releaseGuard = `EXISTS (
        SELECT 1 FROM games g
        JOIN assignment_batches b ON b.game_id = g.id
        WHERE g.id = ? AND g.status = 'ACTIVE' AND g.setup_revision = ?
          AND b.id = ? AND b.released_at IS NULL AND b.setup_revision = ?
          AND b.roster_fingerprint = ? AND b.composition_fingerprint = ?
      )`;
      const result = await db.batch([
        // Claim the lifecycle transition first. Stop racing this request either
        // wins before this statement, or waits until the whole batch commits.
        db
          .prepare(
            `UPDATE games SET status = 'ACTIVE', updated_at = ?
             WHERE id = ? AND status = 'ASSIGNMENT_PREVIEW' AND setup_revision = ?
               AND NOT EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.game_id = games.id)
               AND EXISTS (
                 SELECT 1 FROM assignment_batches b
                 WHERE b.id = ? AND b.game_id = games.id AND b.released_at IS NULL
                   AND b.setup_revision = ? AND b.roster_fingerprint = ? AND b.composition_fingerprint = ?
               )`,
          )
          .bind(now, gameId, setupRevision, body.batchId, setupRevision, rosterFingerprint, compositionFingerprint),
        ...assignments.map((assignment) =>
          db
            .prepare(
              `INSERT INTO role_assignments (game_id, seat_id, role_key, assignment_batch_id)
               SELECT ?, ?, ?, ? WHERE ${releaseGuard}
                 AND NOT EXISTS (SELECT 1 FROM role_assignments existing WHERE existing.game_id = ? AND existing.seat_id = ?)`,
            )
            .bind(gameId, assignment.seatId, canonicalRoleKey(String(assignment.role)), body.batchId, gameId, setupRevision, body.batchId, setupRevision, rosterFingerprint, compositionFingerprint, gameId, assignment.seatId),
        ),
        db
          .prepare(
            `UPDATE assignment_batches SET released_at = ?
             WHERE id = ? AND game_id = ? AND released_at IS NULL AND setup_revision = ?
               AND roster_fingerprint = ? AND composition_fingerprint = ?
               AND EXISTS (SELECT 1 FROM games g WHERE g.id = ? AND g.status = 'ACTIVE' AND g.setup_revision = ?)
               AND (SELECT COUNT(*) FROM role_assignments ra WHERE ra.game_id = ? AND ra.assignment_batch_id = ?) = ?`,
          )
          .bind(now, body.batchId, gameId, setupRevision, rosterFingerprint, compositionFingerprint, gameId, setupRevision, gameId, body.batchId, assignments.length),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, 'ROLES_RELEASED', ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM assignment_batches b WHERE b.id = ? AND b.game_id = ? AND b.released_at = ?)` ,
          )
          .bind(
            crypto.randomUUID(),
            gameId,
            moderator.id,
            JSON.stringify({ batchId: body.batchId, seatCount: assignments.length }),
            now,
            body.batchId,
            gameId,
            now,
          ),
        // Rooms and memberships for the released roles, in the same transaction.
        ...roomSyncStatements(db, gameId, now),
      ]);
      if (changes(result[0]) !== 1) {
        return jsonError('This assignment preview is no longer current. Refresh and create a new preview.', 409);
      }
      return Response.json({ ok: true, releasedAt: now, setupRevision });
    }

    throw new Error('Unknown assignment action.');
  } catch (error) {
    return routeError(error, 'Unable to update assignments.');
  }
}
