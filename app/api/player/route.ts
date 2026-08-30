import { getD1 } from '../../../db';
import { ensureDatabase } from '../../../db/migrate';
import { getCurrentPlayer } from '../../../lib/auth/session';
import { permissionForRole } from '../../../lib/game/actions';
import { ROLE_CATALOG } from '../../../lib/game/catalog';
import type { ActionKind, PhaseKind, PhaseResolution, RoleKey } from '../../../lib/game/types';
import { jsonError } from '../../../lib/http/security';

export async function GET() {
  try {
    await ensureDatabase();
    const identity = await getCurrentPlayer();
    if (!identity) return jsonError('Player authentication required.', 401);
    const db = getD1();
    const player = await db
      .prepare(
        `SELECT s.id, s.display_name AS displayName, s.alive, g.id AS gameId, g.name AS gameName,
                g.status AS gameStatus, g.timezone, ra.role_key AS role
         FROM seats s JOIN games g ON g.id = s.game_id
         LEFT JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
         WHERE s.id = ? LIMIT 1`,
      )
      .bind(identity.seatId)
      .first<{
        id: string;
        displayName: string;
        alive: number;
        gameId: string;
        gameName: string;
        gameStatus: string;
        timezone: string;
        role: RoleKey | null;
      }>();
    if (!player) return jsonError('Player seat not found.', 404);

    const phase = await db
      .prepare(
        `SELECT id, sequence, kind, status, slots, opens_at AS opensAt, closes_at AS closesAt,
                hunter_deadline_at AS hunterDeadlineAt
         FROM phases WHERE game_id = ?
         AND status IN ('OPEN', 'PENDING_HUNTER', 'PENDING_APPROVAL')
         ORDER BY sequence DESC LIMIT 1`,
      )
      .bind(player.gameId)
      .first<{
        id: string;
        sequence: number;
        kind: PhaseKind;
        status: string;
        slots: number;
        opensAt: string;
        closesAt: string;
        hunterDeadlineAt: string | null;
      }>();

    let permission = player.role && phase
      ? permissionForRole(player.role, phase.kind, Number(phase.slots), phase.status === 'PENDING_HUNTER')
      : { actionKind: null as ActionKind | null, maxTargets: 0, label: 'Waiting for the moderator' };
    let hunterEliminatedIds: string[] = [];
    if (phase?.status === 'PENDING_HUNTER') {
      const proposal = await db
        .prepare(
          `SELECT outcome_json AS outcomeJson FROM resolution_proposals
           WHERE phase_id = ? AND status = 'PROPOSED' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(phase.id)
        .first<{ outcomeJson: string }>();
      const outcome = proposal ? JSON.parse(proposal.outcomeJson) as PhaseResolution : null;
      hunterEliminatedIds = outcome?.eliminations.map((elimination) => elimination.playerId) ?? [];
      if (!outcome?.hunterRequiredIds.includes(player.id)) {
        permission = { actionKind: null, maxTargets: 0, label: 'Waiting for the Hunter' };
      }
    }
    if (!Boolean(player.alive) || phase?.status === 'PENDING_APPROVAL') {
      permission = { actionKind: null, maxTargets: 0, label: Boolean(player.alive) ? 'Waiting for moderator review' : 'Spectating the village' };
    }

    const rosterRows = await db
      .prepare(
        `SELECT s.id, s.display_name AS displayName, s.alive, ra.role_key AS role
         FROM seats s LEFT JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
         WHERE s.game_id = ? AND s.status = 'CLAIMED' ORDER BY s.display_name COLLATE NOCASE`,
      )
      .bind(player.gameId)
      .all<{ id: string; displayName: string; alive: number; role: RoleKey | null }>();
    const roster = rosterRows.results.map((seat) => ({ ...seat, alive: Boolean(seat.alive) }));
    const candidates = permission.actionKind
      ? roster
          .filter((seat) => seat.alive && seat.id !== player.id)
          .filter((seat) => permission.actionKind !== 'WOLF_VOTE' || seat.role !== 'WEREWOLF')
          .filter((seat) => permission.actionKind !== 'HUNTER_SHOT' || !hunterEliminatedIds.includes(seat.id))
          .map(({ id, displayName }) => ({ id, displayName }))
      : [];

    const currentAction = phase && permission.actionKind
      ? await db
          .prepare(
            `SELECT id, kind, target_ids_json AS targetIdsJson, version, submitted_at AS submittedAt
             FROM action_submissions
             WHERE phase_id = ? AND actor_seat_id = ? AND kind = ? AND superseded_at IS NULL LIMIT 1`,
          )
          .bind(phase.id, player.id, permission.actionKind)
          .first<{ id: string; kind: ActionKind; targetIdsJson: string; version: number; submittedAt: string }>()
      : null;

    const teammates = player.role === 'WEREWOLF' || player.role === 'MASON'
      ? roster
          .filter((seat) => seat.id !== player.id && seat.role === player.role)
          .map(({ id, displayName, alive }) => ({ id, displayName, alive }))
      : [];
    const timelineRows = await db
      .prepare(
        `SELECT id, event_type AS eventType, payload_json AS payloadJson, created_at AS createdAt
         FROM game_events WHERE game_id = ? AND event_type IN ('PHASE_PUBLISHED', 'GAME_COMPLETED')
         ORDER BY created_at DESC LIMIT 12`,
      )
      .bind(player.gameId)
      .all<{ id: string; eventType: string; payloadJson: string; createdAt: string }>();
    const notificationRows = await db
      .prepare(
        `SELECT id, type, title, body, created_at AS createdAt
         FROM notifications WHERE seat_id = ? ORDER BY created_at DESC LIMIT 10`,
      )
      .bind(player.id)
      .all();

    let participation = { submitted: 0, eligible: 0 };
    if (phase && permission.actionKind) {
      const submitted = await db
        .prepare(
          `SELECT COUNT(DISTINCT actor_seat_id) AS count FROM action_submissions
           WHERE phase_id = ? AND kind = ? AND superseded_at IS NULL`,
        )
        .bind(phase.id, permission.actionKind)
        .first<{ count: number }>();
      const eligible = permission.actionKind === 'DAY_VOTE'
        ? roster.filter((seat) => seat.alive).length
        : permission.actionKind === 'WOLF_VOTE'
          ? roster.filter((seat) => seat.alive && seat.role === 'WEREWOLF').length
          : 1;
      participation = { submitted: Number(submitted?.count ?? 0), eligible };
    }

    return Response.json({
      ok: true,
      player: {
        id: player.id,
        displayName: player.displayName,
        alive: Boolean(player.alive),
        role: player.role,
        roleDefinition: player.role ? ROLE_CATALOG[player.role] : null,
        teammates,
      },
      game: {
        id: player.gameId,
        name: player.gameName,
        status: player.gameStatus,
        timezone: player.timezone,
        counts: { total: roster.length, living: roster.filter((seat) => seat.alive).length },
      },
      phase: phase ? { ...phase, deadline: phase.status === 'PENDING_HUNTER' ? phase.hunterDeadlineAt : phase.closesAt } : null,
      permission,
      candidates,
      currentAction: currentAction
        ? { ...currentAction, targetIds: JSON.parse(currentAction.targetIdsJson) as string[], targetIdsJson: undefined }
        : null,
      participation,
      timeline: timelineRows.results.map((event) => ({ ...event, payload: JSON.parse(event.payloadJson), payloadJson: undefined })),
      notifications: notificationRows.results,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to load the player dashboard.', 400);
  }
}
