import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { validateComposition, scoreComposition } from '../../../../../lib/game/balance';
import { createAssignmentPreview } from '../../../../../lib/game/assignment';
import { ROLE_CATALOG } from '../../../../../lib/game/catalog';
import { canonicalRoleKey, ROLE_KEYS, type RoleComposition, type RoleKey } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { ensureGameRooms } from '../../../../../lib/chat/rooms';

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

interface AssignmentRow {
  seatId: string;
  role: RoleKey;
}

function secureRolls(count: number): number[] {
  const values = new Uint32Array(count);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value / 2 ** 32);
}

async function loadComposition(gameId: string): Promise<RoleComposition> {
  const rows = await getD1()
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
    const db = getD1();
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
        `SELECT id, revision, assignments_json AS assignmentsJson,
                random_evidence_hash AS randomEvidenceHash, released_at AS releasedAt, created_at AS createdAt
         FROM assignment_batches WHERE game_id = ? ORDER BY revision DESC`,
      )
      .bind(gameId)
      .all();
    return Response.json({
      ok: true,
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
    return jsonError(error instanceof Error ? error.message : 'Unable to load assignments.', 401);
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
    const db = getD1();
    const roster = await db
      .prepare("SELECT id, status FROM seats WHERE game_id = ? AND status != 'REMOVED' ORDER BY id")
      .bind(gameId)
      .all<{ id: string; status: string }>();
    if (roster.results.length < 20 || roster.results.length > 80) {
      throw new Error('A valid 20–80 player roster is required.');
    }
    const releasedCount = await db
      .prepare('SELECT COUNT(*) AS count FROM role_assignments WHERE game_id = ?')
      .bind(gameId)
      .first<{ count: number }>();
    const rolesAreReleased = Number(releasedCount?.count ?? 0) > 0;

    if (body.action === 'SAVE_COMPOSITION') {
      if (rolesAreReleased) throw new Error('Role composition is locked after roles are released.');
      const rawComposition = body.composition as (Partial<Record<RoleKey | 'DOCTOR', unknown>> | undefined);
      const composition = Object.fromEntries(
        ROLE_KEYS.map((role) => [role, Number(rawComposition?.[role] ?? (role === 'BODYGUARD' ? rawComposition?.DOCTOR : 0) ?? 0)]),
      ) as RoleComposition;
      const validation = validateComposition(composition, roster.results.length);
      if (!validation.valid) return Response.json({ ok: false, errors: validation.errors }, { status: 400 });
      const now = new Date().toISOString();
      await db.batch([
        db.prepare('DELETE FROM game_role_counts WHERE game_id = ?').bind(gameId),
        ...ROLE_KEYS.map((role) =>
          db
            .prepare(
              'INSERT INTO game_role_counts (game_id, role_key, count, power_snapshot) VALUES (?, ?, ?, ?)',
            )
            .bind(gameId, role, composition[role], ROLE_CATALOG[role].power),
        ),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, 'COMPOSITION_UPDATED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ composition }), now),
      ]);
      return Response.json({ ok: true, composition, balance: scoreComposition(composition) });
    }

    if (body.action === 'PREVIEW') {
      if (rolesAreReleased) throw new Error('Assignments are locked after roles are released.');
      if (roster.results.some((seat) => seat.status !== 'CLAIMED')) {
        throw new Error('Every invited player must claim their seat before roles are randomized.');
      }
      const composition = await loadComposition(gameId);
      const preview = await createAssignmentPreview(
        roster.results.map((seat) => seat.id),
        composition,
        secureRolls(Math.max(0, roster.results.length - 1)),
      );
      const currentRevision = await db
        .prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM assignment_batches WHERE game_id = ?')
        .bind(gameId)
        .first<{ revision: number }>();
      const batchId = crypto.randomUUID();
      const revision = Number(currentRevision?.revision ?? 0) + 1;
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            `INSERT INTO assignment_batches
             (id, game_id, revision, assignments_json, random_evidence_hash, created_by_moderator_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            batchId,
            gameId,
            revision,
            JSON.stringify(preview.assignments),
            preview.evidenceHash,
            moderator.id,
            now,
          ),
        db
          .prepare("UPDATE games SET status = 'ASSIGNMENT_PREVIEW', updated_at = ? WHERE id = ?")
          .bind(now, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, 'ASSIGNMENT_PREVIEWED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ batchId, revision }), now),
      ]);
      return Response.json({ ok: true, batchId, revision, ...preview });
    }

    if (body.action === 'RELEASE') {
      if (!body.batchId) throw new Error('Choose a randomized batch to release.');
      if (rolesAreReleased) {
        throw new Error('Roles have already been released for this game.');
      }
      const batch = await db
        .prepare(
          `SELECT assignments_json AS assignmentsJson FROM assignment_batches
           WHERE id = ? AND game_id = ? AND released_at IS NULL LIMIT 1`,
        )
        .bind(body.batchId, gameId)
        .first<{ assignmentsJson: string }>();
      if (!batch) throw new Error('That assignment batch is not available.');
      const assignments = JSON.parse(batch.assignmentsJson) as AssignmentRow[];
      if (assignments.length !== roster.results.length) throw new Error('Assignment batch does not match the roster.');
      const now = new Date().toISOString();
      await db.batch([
        ...assignments.map((assignment) =>
          db
            .prepare(
              `INSERT INTO role_assignments (game_id, seat_id, role_key, assignment_batch_id)
               VALUES (?, ?, ?, ?)`,
            )
            .bind(gameId, assignment.seatId, assignment.role, body.batchId),
        ),
        db.prepare('UPDATE assignment_batches SET released_at = ? WHERE id = ?').bind(now, body.batchId),
        db.prepare("UPDATE games SET status = 'ACTIVE', updated_at = ? WHERE id = ?").bind(now, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, 'ROLES_RELEASED', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            gameId,
            moderator.id,
            JSON.stringify({ batchId: body.batchId, seatCount: assignments.length }),
            now,
          ),
      ]);
      await ensureGameRooms(gameId);
      return Response.json({ ok: true, releasedAt: now });
    }

    throw new Error('Unknown assignment action.');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update assignments.', 400);
  }
}
