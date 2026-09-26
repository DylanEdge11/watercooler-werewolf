import { getDb } from '../../../db';
import { ensureDatabase } from '../../../db/migrate';
import { getCurrentPlayer } from '../../../lib/auth/session';
import { participationCounter, participationCountsAcrossPlayers, permissionForRole } from '../../../lib/game/actions';
import { automaticStepDueAt } from '../../../lib/game/automation';
import { advanceGameSafely } from '../../../lib/game/automation-sweep';
import { ROLE_CATALOG } from '../../../lib/game/catalog';
import { canonicalRoleKey, type ActionKind, type PhaseKind, type PhaseResolution, type RoleKey } from '../../../lib/game/types';
import { jsonError } from '../../../lib/http/security';
import { routeError } from '../../../lib/http/errors';
import { ensureGameRoomsExist } from '../../../lib/chat/rooms';
import { loadCurrentLoverPair } from '../../../lib/game/relationships';

const TIMELINE_LIMIT = 100;

interface PublicVoteRow {
  id: string;
  phaseId: string;
  actorName: string;
  targetIdsJson: string;
  submittedAt: string;
}

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const identity = await getCurrentPlayer();
    if (!identity) return jsonError('Player authentication required.', 401);
    // Any automatic step that is due (lock and calculate, Hunter follow-up, publish) happens
    // on this visit, so the game moves on even with no cron. When nothing is due, the sweep costs one query.
    const automation = await advanceGameSafely(identity.gameId);
    const due = automation ? automaticStepDueAt(automation.game, automation.phase) : null;
    const db = getDb();
    const player = await db
      .prepare(
        `SELECT s.id, s.display_name AS displayName, s.alive, g.id AS gameId, g.name AS gameName,
                g.status AS gameStatus, g.timezone, g.stop_reason AS stopReason, ra.role_key AS role
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
        stopReason: string | null;
        role: RoleKey | null;
      }>();
    if (!player) return jsonError('Player seat not found.', 404);
    if (player.role) player.role = canonicalRoleKey(player.role);
    // Membership is kept current by release and publish; this read only repairs missing rooms.
    if (player.role) await ensureGameRoomsExist(player.gameId);

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

    const rosterRows = await db
      .prepare(
        `SELECT s.id, s.display_name AS displayName, s.alive, ra.role_key AS role
         FROM seats s LEFT JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
         WHERE s.game_id = ? AND s.status = 'CLAIMED' ORDER BY s.display_name COLLATE NOCASE`,
      )
      .bind(player.gameId)
      .all<{ id: string; displayName: string; alive: number; role: RoleKey | null }>();
    const roster = rosterRows.results.map((seat) => ({ ...seat, role: seat.role ? canonicalRoleKey(seat.role) : null, alive: Boolean(seat.alive) }));
    const seerAlive = roster.some((seat) => seat.alive && seat.role === 'SEER');
    const loverPair = await loadCurrentLoverPair(player.gameId);
    let permission = player.role && phase
      ? permissionForRole(player.role, phase.kind, Number(phase.slots), phase.status === 'PENDING_HUNTER', {
          seerAlive,
          cupidPairExists: Boolean(loverPair),
        })
      : { actionKind: null as ActionKind | null, maxTargets: 0, label: 'Waiting for the moderator' };
    let hunterEliminatedIds: string[] = [];
    if (phase?.status === 'PENDING_HUNTER') {
      const proposal = await db
        .prepare(
          `SELECT COALESCE(reviewed_outcome_json, outcome_json) AS outcomeJson FROM resolution_proposals
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
    if (player.gameStatus === 'STOPPED') {
      permission = { actionKind: null, maxTargets: 0, label: 'This game has been stopped by a moderator.' };
    }
    const livingPlayers = roster.filter((seat) => seat.alive).map(({ id, displayName }) => ({ id, displayName }));
    const eliminatedPlayers = roster
      .filter((seat) => !seat.alive)
      .map(({ id, displayName, role }) => ({ id, displayName, role }));
    const werewolvesRemaining = roster.filter((seat) => seat.alive && seat.role === 'WEREWOLF').length;
    const candidates = permission.actionKind
      ? roster
          .filter((seat) => seat.alive && (permission.actionKind === 'CUPID_PAIR' || seat.id !== player.id))
          .filter((seat) => permission.actionKind !== 'WOLF_VOTE' || seat.role !== 'WEREWOLF')
          .filter((seat) => permission.actionKind !== 'HUNTER_SHOT' || !hunterEliminatedIds.includes(seat.id))
          .map(({ id, displayName }) => ({ id, displayName: id === player.id ? `${displayName} (you)` : displayName }))
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
    const inheritedSeer = player.role === 'APPRENTICE_SEER' && !seerAlive
      ? roster.find((seat) => seat.role === 'SEER')
      : undefined;
    const notificationSeatIds = [...new Set([player.id, ...(inheritedSeer ? [inheritedSeer.id] : [])])];
    const notificationSeatFilter = inheritedSeer
      ? "(seat_id = ? OR (seat_id = ? AND type = 'INVESTIGATION_RESULT'))"
      : 'seat_id = ?';
    // Reset and restore deliberately retain the audit trail, but a fresh run
    // must not make the prior campaign look like the current player's story.
    // The boundary event is written in the same transaction as the reset or
    // restore, so every subsequent player-facing event has an unambiguous
    // lower bound without deleting historical evidence.
    const runBoundary = await db
      .prepare(
        `SELECT MAX(created_at) AS createdAt FROM game_events
         WHERE game_id = ? AND event_type IN ('GAME_RESET', 'GAME_RESTORED')`,
      )
      .bind(player.gameId)
      .first<{ createdAt: string | null }>();
    const requestUrl = new URL(request.url);
    const notificationBefore = requestUrl.searchParams.get('notificationBefore');
    const notificationBeforeId = requestUrl.searchParams.get('notificationBeforeId');
    if (
      (notificationBefore && Number.isNaN(new Date(notificationBefore).valueOf()))
      || (notificationBefore && !notificationBeforeId)
      || (!notificationBefore && notificationBeforeId)
    ) {
      return jsonError('The notification history cursor is invalid.', 400);
    }
    const timelineRows = await db
      .prepare(
        `SELECT ge.id, ge.event_type AS eventType, ge.phase_id AS phaseId,
                p.sequence AS phaseSequence, ge.payload_json AS payloadJson, ge.created_at AS createdAt
         FROM game_events ge LEFT JOIN phases p ON p.id = ge.phase_id
         WHERE ge.game_id = ?
           AND (ge.created_at > COALESCE(?, '') OR (ge.created_at = ? AND ge.event_type NOT IN ('GAME_RESET', 'GAME_RESTORED')))
           AND ge.event_type IN ('PHASE_PUBLISHED', 'GAME_COMPLETED', 'ANNOUNCEMENT', 'GAME_STOPPED', 'FINAL_SHOWDOWN_ENTERED')
           ORDER BY ge.created_at DESC LIMIT ${TIMELINE_LIMIT + 1}`,
      )
      .bind(player.gameId, runBoundary?.createdAt ?? null, runBoundary?.createdAt ?? null)
      .all<{ id: string; eventType: string; phaseId: string | null; phaseSequence: number | null; payloadJson: string; createdAt: string }>();

    const publicVoteRows = await db
      .prepare(
        `SELECT a.id, p.id AS phaseId, s.display_name AS actorName,
                a.target_ids_json AS targetIdsJson, a.submitted_at AS submittedAt
         FROM phases p
         JOIN action_submissions a ON a.phase_id = p.id
         JOIN seats s ON s.id = a.actor_seat_id
         WHERE p.game_id = ? AND p.status = 'PUBLISHED'
           AND p.kind IN ('DAY', 'FINAL_BALLOT')
           AND a.kind = 'DAY_VOTE' AND a.superseded_at IS NULL
           AND p.created_at > COALESCE(?, '')
         ORDER BY p.sequence ASC, a.submitted_at ASC, a.id ASC`,
      )
      .bind(player.gameId, runBoundary?.createdAt ?? null)
      .all<PublicVoteRow>();
    const displayNameById = new Map(roster.map((seat) => [seat.id, seat.displayName]));
    const publicVotesByPhase = new Map<string, Array<{ actorName: string; targetNames: string[] }>>();
    for (const vote of publicVoteRows.results) {
      let targetIds: unknown[] = [];
      try {
        const parsed = JSON.parse(vote.targetIdsJson) as unknown;
        targetIds = Array.isArray(parsed) ? parsed : [];
      } catch {
        targetIds = [];
      }
      const targetNames = targetIds
        .filter((targetId): targetId is string => typeof targetId === 'string')
        .map((targetId) => displayNameById.get(targetId))
        .filter((name): name is string => Boolean(name));
      const phaseVotes = publicVotesByPhase.get(vote.phaseId) ?? [];
      phaseVotes.push({ actorName: vote.actorName, targetNames });
      publicVotesByPhase.set(vote.phaseId, phaseVotes);
    }
    const notificationLimit = 25;
    const notificationWhere = notificationBefore
      ? ' AND (created_at < ? OR (created_at = ? AND id < ?))'
      : '';
    const notificationBindings: Array<string | number> = [...notificationSeatIds];
    if (notificationBefore) notificationBindings.push(notificationBefore, notificationBefore, notificationBeforeId!);
    notificationBindings.push(notificationLimit);
    const notificationRows = await db
      .prepare(
        `SELECT id, type, title, body, created_at AS createdAt
         FROM notifications WHERE ${notificationSeatFilter}${notificationWhere}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(...notificationBindings)
      .all<{ id: string; type: string; title: string; body: string; createdAt: string }>();
    const notificationsHasMore = notificationRows.results.length === notificationLimit;
    const lastNotification = notificationRows.results.at(-1);
    const roomRows = await db
      .prepare(
        `SELECT cr.id, cr.type, cr.status, crm.access
         FROM chat_rooms cr JOIN chat_room_members crm ON crm.room_id = cr.id
         WHERE cr.game_id = ? AND crm.seat_id = ? AND crm.access != 'REVOKED' AND cr.status != 'PURGED'
         ORDER BY cr.type`,
      )
      .bind(player.gameId, player.id)
      .all();

    const sharedSubmissions = phase && participationCountsAcrossPlayers(permission.actionKind)
      ? await db
          .prepare(
            `SELECT COUNT(DISTINCT actor_seat_id) AS count FROM action_submissions
             WHERE phase_id = ? AND kind = ? AND superseded_at IS NULL`,
          )
          .bind(phase.id, permission.actionKind)
          .first<{ count: number }>()
      : null;
    const participation = participationCounter({
      actionKind: phase ? permission.actionKind : null,
      livingPlayers: livingPlayers.length,
      livingWerewolves: werewolvesRemaining,
      sharedSubmissions: Number(sharedSubmissions?.count ?? 0),
      ownSubmission: Boolean(currentAction),
    });

    // One extra row tells the full Timeline that older updates were left out.
    const timelineHasMore = timelineRows.results.length > TIMELINE_LIMIT;
    const publicTimeline = timelineRows.results.slice(0, TIMELINE_LIMIT).map((event) => {
      const payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
      if (event.eventType === 'PHASE_PUBLISHED') {
        const rawEliminations = Array.isArray(payload.eliminations) ? payload.eliminations : [];
        const eliminations = rawEliminations.map((item) => {
          const elimination = item as Record<string, unknown>;
          return {
            displayName: elimination.displayName,
            role: elimination.role,
            cause: elimination.cause,
            // Marks the reader's own elimination. Seat ids aren't secret (players see them in livingPlayers),
            // but the timeline doesn't need them.
            isYou: elimination.playerId === player.id,
          };
        });
        const publishedOutcome = payload.publishedOutcome && typeof payload.publishedOutcome === 'object'
          ? payload.publishedOutcome as Record<string, unknown>
          : null;
        const selectedTargets = Array.isArray(publishedOutcome?.selectedTargets)
          ? publishedOutcome.selectedTargets.filter((id): id is string => typeof id === 'string')
          : [];
        const protectedPlayerIds = Array.isArray(publishedOutcome?.protectedPlayerIds)
          ? publishedOutcome.protectedPlayerIds.filter((id): id is string => typeof id === 'string')
          : [];
        const packEliminatedIds = new Set(rawEliminations
          .map((item) => item as Record<string, unknown>)
          .filter((item) => item.cause === 'WEREWOLF_ATTACK')
          .map((item) => item.playerId)
          .filter((id): id is string => typeof id === 'string'));
        const protectedAttackBlocked = selectedTargets.some((id) =>
          protectedPlayerIds.includes(id)
          && !packEliminatedIds.has(id),
        );
        return {
          id: event.id,
          eventType: event.eventType,
          createdAt: event.createdAt,
          payload: {
            phaseId: event.phaseId,
            sequence: event.phaseSequence,
            kind: payload.kind,
            eliminations,
            protectedAttackBlocked,
            winner: payload.winner ?? null,
            publishedAutomatically: payload.source === 'SCHEDULER',
            votes: ['DAY', 'FINAL_BALLOT'].includes(String(payload.kind)) && event.phaseId
              ? publicVotesByPhase.get(event.phaseId) ?? []
              : undefined,
          },
        };
      }
      if (event.eventType === 'GAME_COMPLETED') {
        return {
          id: event.id,
          eventType: event.eventType,
          createdAt: event.createdAt,
          payload: { winner: payload.winner ?? null },
        };
      }
      if (event.eventType === 'ANNOUNCEMENT') {
        return {
          id: event.id,
          eventType: event.eventType,
          createdAt: event.createdAt,
          payload: { title: payload.title, body: payload.body },
        };
      }
      return {
        id: event.id,
        eventType: event.eventType,
        createdAt: event.createdAt,
        payload: {},
      };
    });

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
        stopReason: player.stopReason,
        automationPaused: Boolean(automation?.game.pausedAt),
        counts: { total: roster.length, living: livingPlayers.length, werewolvesRemaining },
        livingPlayers,
        eliminatedPlayers,
      },
      phase: phase
        ? {
            ...phase,
            deadline: phase.status === 'PENDING_HUNTER' ? phase.hunterDeadlineAt : phase.closesAt,
            // Set while a calculated result waits in automatic mode: it publishes then unless a moderator acts first.
            autoPublishAt: due?.kind === 'PUBLISH' && automation?.phase?.id === phase.id ? due.at : null,
          }
        : null,
      permission,
      candidates,
      currentAction: currentAction
        ? { ...currentAction, targetIds: JSON.parse(currentAction.targetIdsJson) as string[], targetIdsJson: undefined }
        : null,
      participation,
      timeline: publicTimeline,
      timelineHasMore,
      notifications: notificationRows.results,
      notificationsHasMore,
      notificationsNextCursor: notificationsHasMore && lastNotification ? { createdAt: lastNotification.createdAt, id: lastNotification.id } : null,
      rooms: roomRows.results,
    });
  } catch (error) {
    return routeError(error, 'Unable to load the player dashboard.');
  }
}
