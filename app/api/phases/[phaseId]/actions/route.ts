import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { getCurrentPlayer } from '../../../../../lib/auth/session';
import { permissionForRole, validateActionTargets } from '../../../../../lib/game/actions';
import { canonicalRoleKey, type ActionKind, type PhaseKind, type PhaseResolution, type PlayerState, type RoleKey } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { enforceRateLimit, requestRateLimitKey, RateLimitError } from '../../../../../lib/http/rate-limit';

interface RouteContext {
  params: Promise<{ phaseId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const identity = await getCurrentPlayer();
    if (!identity) return jsonError('Player authentication required.', 401);
    const playerIdentity = identity;
    const { phaseId } = await context.params;
    const body = (await request.json()) as { actionKind?: ActionKind; targetIds?: string[] };
    const db = getDb();
    const phase = await db
      .prepare(
        `SELECT p.id, p.game_id AS gameId, p.kind, p.status, p.slots, p.closes_at AS closesAt,
                p.hunter_deadline_at AS hunterDeadlineAt, g.status AS gameStatus
         FROM phases p JOIN games g ON g.id = p.game_id WHERE p.id = ? LIMIT 1`,
      )
      .bind(phaseId)
      .first<{
        id: string;
        gameId: string;
        kind: PhaseKind;
        status: string;
        slots: number;
        closesAt: string;
        hunterDeadlineAt: string | null;
        gameStatus: string;
      }>();
    if (!phase || phase.gameId !== identity.gameId) return jsonError('Phase not found.', 404);
    if (phase.gameStatus === 'STOPPED') throw new Error('This game has been stopped by a moderator.');
    const pendingHunter = phase.status === 'PENDING_HUNTER';
    const nowForDeadline = new Date();
    const deadline = pendingHunter ? phase.hunterDeadlineAt : phase.closesAt;
    async function recordLateAttempt() {
      const createdAt = nowForDeadline.toISOString();
      await db
        .prepare(
          `INSERT INTO operational_events
           (id, game_id, severity, source, message, details_json, created_at)
           VALUES (?, ?, 'WARNING', 'DEADLINE_MONITOR', 'A late player action was rejected.', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          playerIdentity.gameId,
          JSON.stringify({ phaseId, seatId: playerIdentity.seatId, actionKind: body.actionKind ?? null, deadline }),
          createdAt,
        )
        .run();
    }
    if (phase.status !== 'OPEN' && !pendingHunter) {
      if (deadline && new Date(deadline) <= nowForDeadline) await recordLateAttempt();
      throw new Error('This phase is not accepting actions.');
    }
    if (deadline && new Date(deadline) <= nowForDeadline) {
      await recordLateAttempt();
      throw new Error('The response window has closed.');
    }

    const playerRows = await db
      .prepare(
        `SELECT s.id, s.display_name AS displayName, ra.role_key AS role, s.alive
         FROM seats s JOIN role_assignments ra ON ra.seat_id = s.id AND ra.game_id = s.game_id
         WHERE s.game_id = ? AND s.status = 'CLAIMED'`,
      )
      .bind(identity.gameId)
      .all<{ id: string; displayName: string; role: RoleKey; alive: number }>();
    const players: PlayerState[] = playerRows.results.map((row) => ({ ...row, role: canonicalRoleKey(row.role), alive: Boolean(row.alive) }));
    const actor = players.find((player) => player.id === identity.seatId);
    if (!actor?.alive) throw new Error('Eliminated players cannot submit this action.');
    await enforceRateLimit(requestRateLimitKey(request, `player-action:${identity.seatId}:${phaseId}`), 30, 10 * 60_000);
    const permission = permissionForRole(actor.role, phase.kind, Number(phase.slots), pendingHunter);
    if (!permission.actionKind || body.actionKind !== permission.actionKind) throw new Error('This action is not available to your role.');

    let hunterEliminatedIds: string[] | undefined;
    if (pendingHunter) {
      const proposal = await db
        .prepare(
          `SELECT COALESCE(reviewed_outcome_json, outcome_json) AS outcomeJson FROM resolution_proposals
           WHERE phase_id = ? AND status = 'PROPOSED' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(phase.id)
        .first<{ outcomeJson: string }>();
      if (!proposal) throw new Error('Hunter follow-up is not available.');
      const outcome = JSON.parse(proposal.outcomeJson) as PhaseResolution;
      if (!outcome.hunterRequiredIds.includes(actor.id)) throw new Error('This Hunter follow-up belongs to another seat.');
      hunterEliminatedIds = outcome.eliminations.map((elimination) => elimination.playerId);
    }

    const targetIds = Array.isArray(body.targetIds) ? body.targetIds.filter((id): id is string => typeof id === 'string') : [];
    const errors = validateActionTargets({
      actor,
      players,
      actionKind: permission.actionKind,
      targetIds,
      maxTargets: permission.maxTargets,
      hunterEliminatedIds,
    });
    if (errors.length) return Response.json({ ok: false, errors }, { status: 400 });

    const now = new Date().toISOString();
    const actionId = crypto.randomUUID();
    const acceptedWindow = pendingHunter
      ? "p.status = 'PENDING_HUNTER' AND p.hunter_deadline_at > ?"
      : "p.status = 'OPEN' AND p.closes_at > ?";
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO action_submissions
           (id, phase_id, actor_seat_id, kind, target_ids_json, version, submitted_at)
           SELECT ?, ?, ?, ?, ?,
                  COALESCE((SELECT MAX(version) FROM action_submissions
                            WHERE phase_id = ? AND actor_seat_id = ? AND kind = ?), 0) + 1,
                  ?
           FROM phases p JOIN games g ON g.id = p.game_id
           WHERE p.id = ? AND p.game_id = ? AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')
             AND ${acceptedWindow}
             AND EXISTS (
               SELECT 1 FROM seats s
               WHERE s.id = ? AND s.game_id = p.game_id AND s.status = 'CLAIMED' AND s.alive = 1
             )`,
        )
        .bind(
          actionId,
          phase.id,
          actor.id,
          permission.actionKind,
          JSON.stringify(targetIds),
          phase.id,
          actor.id,
          permission.actionKind,
          now,
          phase.id,
          identity.gameId,
          now,
          actor.id,
        ),
      db
        .prepare(
          `UPDATE action_submissions SET superseded_at = ?
           WHERE phase_id = ? AND actor_seat_id = ? AND kind = ? AND superseded_at IS NULL AND id != ?
             AND EXISTS (SELECT 1 FROM action_submissions WHERE id = ?)`,
        )
        .bind(now, phase.id, actor.id, permission.actionKind, actionId, actionId),
    ]);
    if (Number(result[0]?.meta?.changes ?? 0) !== 1) {
      await recordLateAttempt();
      return jsonError('The phase closed while your response was being saved. Refresh and try again if a response window is still open.', 409);
    }
    const revision = await db
      .prepare('SELECT version FROM action_submissions WHERE id = ? LIMIT 1')
      .bind(actionId)
      .first<{ version: number }>();
    const version = Number(revision?.version ?? 1);
    await db
      .prepare(
        `INSERT INTO game_events
         (id, game_id, phase_id, event_type, actor_seat_id, payload_json, created_at)
         VALUES (?, ?, ?, 'ACTION_SUBMITTED', ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), identity.gameId, phase.id, actor.id, JSON.stringify({ kind: permission.actionKind, version }), now)
      .run();
    return Response.json({ ok: true, actionId, version, targetIds, submittedAt: now });
  } catch (error) {
    return error instanceof RateLimitError
      ? jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : jsonError(error instanceof Error ? error.message : 'Unable to submit this action.', 400);
  }
}
