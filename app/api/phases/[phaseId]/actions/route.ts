import { getDb } from '../../../../../db';
import { changes } from '../../../../../db/results';
import { ensureDatabase } from '../../../../../db/migrate';
import { getCurrentPlayer } from '../../../../../lib/auth/session';
import { afterlifePermission, permissionForRole, validateActionTargets } from '../../../../../lib/game/actions';
import { canonicalRoleKey, type ActionKind, type PhaseKind, type PhaseResolution, type PlayerState, type RoleKey } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { routeError } from '../../../../../lib/http/errors';
import { checkRateLimitRow, rateLimitStatements, requestRateLimitKey } from '../../../../../lib/http/rate-limit';
import { loadCurrentLoverPair } from '../../../../../lib/game/relationships';

/** Saved actions per player per phase: 30 every 10 minutes, enough for many revisions. */
const ACTION_RATE_LIMIT = 30;
const ACTION_RATE_WINDOW_MS = 10 * 60_000;

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
    // The three reads need only the player's game, so they share one round trip.
    const [phase, playerRows, loverPair] = await Promise.all([
      db
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
        }>(),
      db
        .prepare(
          `SELECT s.id, s.display_name AS displayName, ra.role_key AS role, s.alive
           FROM seats s JOIN role_assignments ra ON ra.seat_id = s.id AND ra.game_id = s.game_id
           WHERE s.game_id = ? AND s.status = 'CLAIMED'`,
        )
        .bind(identity.gameId)
        .all<{ id: string; displayName: string; role: RoleKey; alive: number }>(),
      loadCurrentLoverPair(identity.gameId),
    ]);
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

    const players: PlayerState[] = playerRows.results.map((row) => ({ ...row, role: canonicalRoleKey(row.role), alive: Boolean(row.alive) }));
    const actor = players.find((player) => player.id === identity.seatId);
    if (!actor) throw new Error('Only seated players can submit this action.');
    // Eliminated players have only the optional Afterlife tiebreak vote.
    const permission = actor.alive
      ? permissionForRole(actor.role, phase.kind, Number(phase.slots), pendingHunter, {
          seerAlive: players.some((player) => player.alive && player.role === 'SEER'),
          cupidPairExists: Boolean(loverPair),
        })
      : afterlifePermission(phase.kind, Number(phase.slots), pendingHunter);
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

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const actionId = crypto.randomUUID();
    const rateLimitKey = requestRateLimitKey(request, `player-action:${identity.seatId}:${phaseId}`);
    const acceptedWindow = pendingHunter
      ? "p.status = 'PENDING_HUNTER' AND p.hunter_deadline_at > ?"
      : "p.status = 'OPEN' AND p.closes_at > ?";
    // One transaction counts the attempt against the rate limit and saves the
    // action only when the attempt is within it, so a vote costs one write.
    const result = await db.batch([
      ...rateLimitStatements(db, rateLimitKey, ACTION_RATE_WINDOW_MS, now),
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
               WHERE s.id = ? AND s.game_id = p.game_id AND s.status = 'CLAIMED' AND s.alive = ?
             )
             AND (SELECT attempts FROM rate_limit_buckets WHERE bucket_key = ?) <= ?`,
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
          permission.actionKind === 'AFTERLIFE_VOTE' ? 0 : 1,
          rateLimitKey,
          ACTION_RATE_LIMIT,
        ),
      db
        .prepare(
          `UPDATE action_submissions SET superseded_at = ?
           WHERE phase_id = ? AND actor_seat_id = ? AND kind = ? AND superseded_at IS NULL AND id != ?
             AND EXISTS (SELECT 1 FROM action_submissions WHERE id = ?)`,
        )
        .bind(now, phase.id, actor.id, permission.actionKind, actionId, actionId),
      // The audit event and the saved revision number come from the same transaction as the action.
      db
        .prepare(
          `INSERT INTO game_events
           (id, game_id, phase_id, event_type, actor_seat_id, payload_json, created_at)
           SELECT ?, ?, ?, 'ACTION_SUBMITTED', ?, json_object('kind', a.kind, 'version', a.version), ?
           FROM action_submissions a WHERE a.id = ?`,
        )
        .bind(crypto.randomUUID(), identity.gameId, phase.id, actor.id, now, actionId),
      db.prepare('SELECT version FROM action_submissions WHERE id = ? LIMIT 1').bind(actionId),
    ]);
    checkRateLimitRow(result[2]?.results[0], ACTION_RATE_LIMIT, ACTION_RATE_WINDOW_MS, nowDate);
    if (changes(result[3]) !== 1) {
      await recordLateAttempt();
      return jsonError('The phase closed while your response was being saved. Refresh and try again if a response window is still open.', 409);
    }
    const version = Number((result[6]?.results[0] as { version?: number } | undefined)?.version ?? 1);
    return Response.json({ ok: true, actionId, version, targetIds, submittedAt: now });
  } catch (error) {
    return routeError(error, 'Unable to submit this action.');
  }
}
