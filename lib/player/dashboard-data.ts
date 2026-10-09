import { getDb } from '../../db';
import type { PreparedStatement, QueryResult, RunResult } from '../../db/contracts';
import { ensureGameRooms, ROOM_TYPE_COUNT } from '../chat/rooms';
import { afterlifePermission, participationCounter, participationCountsAcrossPlayers, permissionForRole } from '../game/actions';
import { automaticStepDueAt } from '../game/automation';
import type { advanceGameSafely } from '../game/automation-sweep';
import { ROLE_CATALOG } from '../game/catalog';
import { afterlifeBrokeTie, protectedAttackBlocked } from '../game/public-result';
import { spectatorCanPost } from '../game/spectators';
import { loadCurrentLoverPair } from '../game/relationships';
import { emailNotificationsAvailable } from '../notify/config';
import { canonicalRoleKey, type ActionKind, type PhaseKind, type PhaseResolution, type RoleKey } from '../game/types';

const TIMELINE_LIMIT = 100;
const NOTIFICATION_LIMIT = 25;

/** Older notifications: those before this time, and at this time with a smaller id. */
export interface NotificationCursor {
  before: string;
  beforeId: string;
}

type Automation = Awaited<ReturnType<typeof advanceGameSafely>>;

interface PublicVoteRow {
  id: string;
  phaseId: string;
  actorName: string;
  targetIdsJson: string;
  submittedAt: string;
}

/**
 * Reset and restore keep the audit trail, but a fresh run must not show the
 * prior campaign. The boundary event is written in the same transaction as
 * the reset or restore, so player-facing events are those strictly after it,
 * or at the same instant when they are not themselves the boundary event.
 */
export const RUN_BOUNDARY = `(SELECT MAX(created_at) FROM game_events
  WHERE game_id = ? AND event_type IN ('GAME_RESET', 'GAME_RESTORED'))`;
/**
 * Queries using this filter name `INDEXED BY idx_game_events_type`. Left to
 * itself SQLite walks every event of the game newest first, including one
 * audit event per vote, to find the few public ones.
 */
const PUBLIC_EVENT_FILTER = `ge.game_id = ?
  AND (ge.created_at > COALESCE(${RUN_BOUNDARY}, '') OR (ge.created_at = ${RUN_BOUNDARY} AND ge.event_type NOT IN ('GAME_RESET', 'GAME_RESTORED')))
  AND ge.event_type IN ('PHASE_PUBLISHED', 'GAME_COMPLETED', 'ANNOUNCEMENT', 'GAME_STOPPED', 'FINAL_SHOWDOWN_ENTERED')`;

export function parseTargetIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((targetId): targetId is string => typeof targetId === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Current Day and Final ballot votes of published phases in this run. Callers
 * add the phase condition and bind (gameId, gameId, ...).
 */
const PUBLISHED_BALLOT_VOTES = `SELECT a.id, p.id AS phaseId, s.display_name AS actorName,
         a.target_ids_json AS targetIdsJson, a.submitted_at AS submittedAt
  FROM phases p
  JOIN action_submissions a ON a.phase_id = p.id
  JOIN seats s ON s.id = a.actor_seat_id
  WHERE p.game_id = ? AND p.status = 'PUBLISHED'
    AND p.kind IN ('DAY', 'FINAL_BALLOT')
    AND a.kind = 'DAY_VOTE' AND a.superseded_at IS NULL
    AND p.created_at > COALESCE(${RUN_BOUNDARY}, '')`;
const BALLOT_VOTE_ORDER = 'ORDER BY a.submitted_at ASC, a.id ASC';
/** The phases of the timeline events a dashboard returns. Binds (gameId, gameId, gameId). */
const SHOWN_PHASE_IDS = `SELECT shown.phase_id FROM (
    SELECT ge.phase_id FROM game_events ge INDEXED BY idx_game_events_type
    WHERE ${PUBLIC_EVENT_FILTER}
    ORDER BY ge.created_at DESC LIMIT ${TIMELINE_LIMIT}
  ) shown WHERE shown.phase_id IS NOT NULL`;

export interface BallotVote {
  actorName: string;
  targetNames: string[];
}

function ballotVotes(rows: PublicVoteRow[], displayNameById: Map<string, string>): BallotVote[] {
  return rows.map((vote) => ({
    actorName: vote.actorName,
    targetNames: parseTargetIds(vote.targetIdsJson)
      .map((targetId) => displayNameById.get(targetId))
      .filter((name): name is string => Boolean(name)),
  }));
}

/**
 * Who voted for whom in one published Day or Final ballot of the player's
 * game. These are public once published; the dashboard sends only the newest
 * ballot's votes and the timeline asks for older ones here. Null when the
 * phase is not a published ballot of this game's current run.
 */
export async function loadBallotVotes(gameId: string, phaseId: string): Promise<BallotVote[] | null> {
  const db = getDb();
  const [phase, voteRows, seatRows] = await Promise.all([
    db
      .prepare(
        `SELECT id FROM phases
         WHERE id = ? AND game_id = ? AND status = 'PUBLISHED' AND kind IN ('DAY', 'FINAL_BALLOT')
           AND created_at > COALESCE(${RUN_BOUNDARY}, '') LIMIT 1`,
      )
      .bind(phaseId, gameId, gameId)
      .first<{ id: string }>(),
    db.prepare(`${PUBLISHED_BALLOT_VOTES} AND p.id = ? ${BALLOT_VOTE_ORDER}`).bind(gameId, gameId, phaseId).all<PublicVoteRow>(),
    db
      .prepare("SELECT id, display_name AS displayName FROM seats WHERE game_id = ? AND status = 'CLAIMED'")
      .bind(gameId)
      .all<{ id: string; displayName: string }>(),
  ]);
  if (!phase) return null;
  return ballotVotes(voteRows.results, new Map(seatRows.results.map((seat) => [seat.id, seat.displayName])));
}

export type RosterSeat = { id: string; displayName: string; alive: boolean; role: RoleKey | null };

interface TimelineRow { id: string; eventType: string; phaseId: string | null; phaseSequence: number | null; payloadJson: string; createdAt: string }

/** The open (or awaiting) phase of a game, if any. */
interface CurrentPhaseRow {
  id: string;
  sequence: number;
  kind: PhaseKind;
  status: string;
  slots: number;
  opensAt: string;
  closesAt: string;
  hunterDeadlineAt: string | null;
}

/** The game's open, hunter-pending, or awaiting-approval phase, newest first. */
function currentPhaseStatement(gameId: string) {
  return getDb()
    .prepare(
      `SELECT id, sequence, kind, status, slots, opens_at AS opensAt, closes_at AS closesAt,
              hunter_deadline_at AS hunterDeadlineAt
       FROM phases WHERE game_id = ?
       AND status IN ('OPEN', 'PENDING_HUNTER', 'PENDING_APPROVAL')
       ORDER BY sequence DESC LIMIT 1`,
    )
    .bind(gameId);
}

interface RosterRow { id: string; displayName: string; alive: number; role: RoleKey | null }

function rosterStatement(gameId: string) {
  return getDb()
    .prepare(
      `SELECT s.id, s.display_name AS displayName, s.alive, ra.role_key AS role
       FROM seats s LEFT JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
       WHERE s.game_id = ? AND s.status = 'CLAIMED' ORDER BY s.display_name COLLATE NOCASE`,
    )
    .bind(gameId);
}

function rosterFromRows(rows: RosterRow[]): RosterSeat[] {
  return rows.map((seat) => ({ ...seat, role: seat.role ? canonicalRoleKey(seat.role) : null, alive: Boolean(seat.alive) }));
}

/** Every claimed seat with its role. Roles are for the server's own decisions; callers send only public fields. */
export async function loadRoster(gameId: string): Promise<RosterSeat[]> {
  return rosterFromRows((await rosterStatement(gameId).all<RosterRow>()).results);
}

/** The rows of one result in a batch. */
function rowsOf<Row>(result: QueryResult | RunResult | undefined): Row[] {
  return (result?.results ?? []) as Row[];
}

/** The three reads behind the public timeline, ready to batch: its events, the newest ballot's votes, and each ballot's vote count. */
function publicTimelineStatements(gameId: string) {
  const db = getDb();
  return [
    db
      .prepare(
        `SELECT ge.id, ge.event_type AS eventType, ge.phase_id AS phaseId,
                p.sequence AS phaseSequence, ge.payload_json AS payloadJson, ge.created_at AS createdAt
         FROM game_events ge INDEXED BY idx_game_events_type LEFT JOIN phases p ON p.id = ge.phase_id
         WHERE ${PUBLIC_EVENT_FILTER}
         ORDER BY ge.created_at DESC LIMIT ${TIMELINE_LIMIT + 1}`,
      )
      .bind(gameId, gameId, gameId),
    // Who voted for whom, for the newest published ballot in the timeline only. Older ballots
    // send a count, and the timeline loads their votes on request, so a long
    // game's refresh doesn't resend every vote ever cast.
    db
      .prepare(
        `${PUBLISHED_BALLOT_VOTES}
           AND p.id = (
             SELECT newest.id FROM phases newest
             WHERE newest.game_id = ? AND newest.status = 'PUBLISHED' AND newest.kind IN ('DAY', 'FINAL_BALLOT')
               AND newest.id IN (${SHOWN_PHASE_IDS})
             ORDER BY newest.sequence DESC LIMIT 1
           )
         ${BALLOT_VOTE_ORDER}`,
      )
      .bind(gameId, gameId, gameId, gameId, gameId, gameId),
    // Vote counts for the ballots in the timeline this response returns.
    db
      .prepare(
        `SELECT p.id AS phaseId, COUNT(*) AS count
         FROM phases p
         JOIN action_submissions a ON a.phase_id = p.id
         WHERE p.game_id = ? AND p.status = 'PUBLISHED'
           AND p.kind IN ('DAY', 'FINAL_BALLOT')
           AND a.kind = 'DAY_VOTE' AND a.superseded_at IS NULL
           AND p.created_at > COALESCE(${RUN_BOUNDARY}, '')
           AND p.id IN (${SHOWN_PHASE_IDS})
         GROUP BY p.id`,
      )
      .bind(gameId, gameId, gameId, gameId, gameId),
  ] as const;
}

/** The public roster lists every viewer of a game sees: living players, and the eliminated with their revealed roles. */
function publicRoster(roster: RosterSeat[]) {
  const livingPlayers = roster.filter((seat) => seat.alive).map(({ id, displayName }) => ({ id, displayName }));
  const eliminatedPlayers = roster
    .filter((seat) => !seat.alive)
    .map(({ id, displayName, role }) => ({ id, displayName, role }));
  const werewolvesRemaining = roster.filter((seat) => seat.alive && seat.role === 'WEREWOLF').length;
  return { livingPlayers, eliminatedPlayers, werewolvesRemaining };
}

/**
 * The official timeline a viewer sees, built from public events only.
 * `viewerSeatId` marks the viewer's own elimination; spectators pass null.
 */
function buildTimeline(
  rows: { timelineRows: TimelineRow[]; newestBallotRows: PublicVoteRow[]; ballotCountRows: Array<{ phaseId: string; count: number }> },
  roster: RosterSeat[],
  viewerSeatId: string | null,
) {
  const { timelineRows, newestBallotRows, ballotCountRows } = rows;
  const displayNameById = new Map(roster.map((seat) => [seat.id, seat.displayName]));
  const newestBallotPhaseId = newestBallotRows[0]?.phaseId ?? null;
  const newestBallotVotes = ballotVotes(newestBallotRows, displayNameById);
  const ballotVoteCounts = new Map(ballotCountRows.map((row) => [row.phaseId, Number(row.count)]));

  // One extra row tells the full Timeline that older updates were left out.
  const timelineHasMore = timelineRows.length > TIMELINE_LIMIT;
  const timeline = timelineRows.slice(0, TIMELINE_LIMIT).map((event) => {
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
          isYou: viewerSeatId !== null && elimination.playerId === viewerSeatId,
        };
      });
      // Only that the Afterlife settled a tie is public; its votes stay with the moderators.
      const brokeTie = afterlifeBrokeTie(payload);
      return {
        id: event.id,
        eventType: event.eventType,
        createdAt: event.createdAt,
        payload: {
          phaseId: event.phaseId,
          sequence: event.phaseSequence,
          kind: payload.kind,
          eliminations,
          protectedAttackBlocked: protectedAttackBlocked(payload),
          ...(brokeTie ? { afterlifeBrokeTie: brokeTie } : {}),
          winner: payload.winner ?? null,
          publishedAutomatically: payload.source === 'SCHEDULER',
          ...(['DAY', 'FINAL_BALLOT'].includes(String(payload.kind)) && event.phaseId
            ? {
                voteCount: ballotVoteCounts.get(event.phaseId) ?? 0,
                // Absent for older ballots: GET /api/phases/:phaseId/votes returns them.
                votes: event.phaseId === newestBallotPhaseId ? newestBallotVotes : undefined,
              }
            : {}),
        },
      };
    }
    if (event.eventType === 'GAME_COMPLETED') {
      return { id: event.id, eventType: event.eventType, createdAt: event.createdAt, payload: { winner: payload.winner ?? null } };
    }
    if (event.eventType === 'ANNOUNCEMENT') {
      return { id: event.id, eventType: event.eventType, createdAt: event.createdAt, payload: { title: payload.title, body: payload.body } };
    }
    return { id: event.id, eventType: event.eventType, createdAt: event.createdAt, payload: {} };
  });

  return { timeline, timelineHasMore };
}

interface PlayerRow {
  id: string;
  displayName: string;
  alive: number;
  gameId: string;
  gameName: string;
  gameStatus: string;
  timezone: string;
  stopReason: string | null;
  role: RoleKey | null;
  emailEnabled: number;
  /** How many chat rooms the game has; fewer than a full set means some need repairing. */
  roomCount: number;
}

function playerStatement(seatId: string) {
  return getDb()
    .prepare(
      `SELECT s.id, s.display_name AS displayName, s.alive, g.id AS gameId, g.name AS gameName,
              g.status AS gameStatus, g.timezone, g.stop_reason AS stopReason, ra.role_key AS role,
              COALESCE(ep.enabled, 0) AS emailEnabled,
              (SELECT COUNT(*) FROM chat_rooms cr WHERE cr.game_id = g.id) AS roomCount
       FROM seats s JOIN games g ON g.id = s.game_id
       LEFT JOIN role_assignments ra ON ra.game_id = s.game_id AND ra.seat_id = s.id
       LEFT JOIN email_preferences ep ON ep.seat_id = s.id
       WHERE s.id = ? LIMIT 1`,
    )
    .bind(seatId);
}

interface PlayerRoomRow { id: string; type: string; status: string; access: string }

function playerRoomsStatement(gameId: string, seatId: string) {
  return getDb()
    .prepare(
      `SELECT cr.id, cr.type, cr.status, crm.access
       FROM chat_rooms cr JOIN chat_room_members crm ON crm.room_id = cr.id
       WHERE cr.game_id = ? AND crm.seat_id = ? AND crm.access != 'REVOKED' AND cr.status != 'PURGED'
       ORDER BY cr.type`,
    )
    .bind(gameId, seatId);
}

/**
 * Everything the player dashboard shows, for one seat. Returns null when the
 * seat does not exist. The reads run in two batches, each one request whose
 * statements see one snapshot: first the seat, the current phase, the roster,
 * the public timeline, and the player's rooms (none needs another's answer
 * once the game id is known), then the reads that need the open phase and the
 * player's permission. Callers that already know the seat's game pass its id
 * as `gameId`; without it one extra read finds it first. A Cupid's lover-pair
 * read sits between the two batches, because only a Cupid's own permission
 * depends on it.
 */
export async function loadDashboard(seatId: string, options: { cursor?: NotificationCursor; automation?: Automation; gameId?: string } = {}) {
  const db = getDb();
  const { cursor, automation } = options;
  const due = automation ? automaticStepDueAt(automation.game, automation.phase) : null;

  let gameId = options.gameId;
  if (!gameId) {
    const owner = await db.prepare('SELECT game_id AS gameId FROM seats WHERE id = ? LIMIT 1').bind(seatId).first<{ gameId: string }>();
    if (!owner) return null;
    gameId = owner.gameId;
  }

  // Batch 1: the seat with its game and role, and everything that needs only the game and the seat.
  const [playerResult, phaseResult, rosterResult, timelineResult, newestBallotResult, ballotCountResult, roomResult] = await db.batch([
    playerStatement(seatId),
    currentPhaseStatement(gameId),
    rosterStatement(gameId),
    ...publicTimelineStatements(gameId),
    playerRoomsStatement(gameId, seatId),
  ], 'read');
  const player = rowsOf<PlayerRow>(playerResult)[0];
  // A seat that belongs to some other game than the one asked about is treated as not found, never answered with the wrong game's data.
  if (!player || player.gameId !== gameId) return null;
  if (player.role) player.role = canonicalRoleKey(player.role);
  const phase = rowsOf<CurrentPhaseRow>(phaseResult)[0] ?? null;
  const roster = rosterFromRows(rowsOf<RosterRow>(rosterResult));
  let roomRows = rowsOf<PlayerRoomRow>(roomResult);
  // Membership is kept current by release and publish; this only repairs missing rooms.
  if (player.role && Number(player.roomCount) < ROOM_TYPE_COUNT) {
    await ensureGameRooms(gameId);
    roomRows = (await playerRoomsStatement(gameId, player.id).all<PlayerRoomRow>()).results;
  }
  // Only a Cupid's permission depends on whether the pair has been chosen.
  const loverPair = player.role === 'CUPID' ? await loadCurrentLoverPair(gameId) : null;

  const seerAlive = roster.some((seat) => seat.alive && seat.role === 'SEER');
  const alive = Boolean(player.alive);
  const basePermission = player.role && phase
    ? alive
      ? permissionForRole(player.role, phase.kind, Number(phase.slots), phase.status === 'PENDING_HUNTER', {
          seerAlive,
          cupidPairExists: Boolean(loverPair),
        })
      : afterlifePermission(phase.kind, Number(phase.slots), phase.status === 'PENDING_HUNTER')
    : { actionKind: null as ActionKind | null, maxTargets: 0, label: 'Waiting for the moderator' };
  // These always end with no action, so batch 2 skips the action reads for them.
  const actionWithdrawn = phase?.status === 'PENDING_APPROVAL' || player.gameStatus === 'STOPPED';
  const actionKind = actionWithdrawn ? null : basePermission.actionKind;
  const inheritedSeer = player.role === 'APPRENTICE_SEER' && !seerAlive
    ? roster.find((seat) => seat.role === 'SEER')
    : undefined;
  const notificationSeatIds = [...new Set([player.id, ...(inheritedSeer ? [inheritedSeer.id] : [])])];
  const notificationSeatFilter = inheritedSeer
    ? "(seat_id = ? OR (seat_id = ? AND type = 'INVESTIGATION_RESULT'))"
    : 'seat_id = ?';
  const notificationBindings: Array<string | number> = [...notificationSeatIds];
  if (cursor) notificationBindings.push(cursor.before, cursor.before, cursor.beforeId);
  notificationBindings.push(NOTIFICATION_LIMIT);

  // Batch 2: reads that need the open phase, the permission, or the roster. Only the ones that apply are sent.
  const reads: PreparedStatement[] = [];
  const slot = { proposal: -1, action: -1, shared: -1, notifications: -1 };
  if (phase?.status === 'PENDING_HUNTER') {
    slot.proposal = reads.push(db
      .prepare(
        `SELECT COALESCE(reviewed_outcome_json, outcome_json) AS outcomeJson FROM resolution_proposals
         WHERE phase_id = ? AND status = 'PROPOSED' ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(phase.id)) - 1;
  }
  if (phase && actionKind) {
    slot.action = reads.push(db
      .prepare(
        `SELECT id, kind, target_ids_json AS targetIdsJson, version, submitted_at AS submittedAt
         FROM action_submissions
         WHERE phase_id = ? AND actor_seat_id = ? AND kind = ? AND superseded_at IS NULL LIMIT 1`,
      )
      .bind(phase.id, player.id, actionKind)) - 1;
  }
  if (phase && actionKind && participationCountsAcrossPlayers(actionKind)) {
    slot.shared = reads.push(db
      .prepare(
        `SELECT COUNT(DISTINCT actor_seat_id) AS count FROM action_submissions
         WHERE phase_id = ? AND kind = ? AND superseded_at IS NULL`,
      )
      .bind(phase.id, actionKind)) - 1;
  }
  slot.notifications = reads.push(db
    .prepare(
      `SELECT id, type, title, body, created_at AS createdAt
       FROM notifications WHERE ${notificationSeatFilter}${cursor ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...notificationBindings)) - 1;
  const secondBatch = await db.batch(reads, 'read');
  const proposal = slot.proposal >= 0 ? rowsOf<{ outcomeJson: string }>(secondBatch[slot.proposal])[0] ?? null : null;
  const fetchedAction = slot.action >= 0
    ? rowsOf<{ id: string; kind: ActionKind; targetIdsJson: string; version: number; submittedAt: string }>(secondBatch[slot.action])[0] ?? null
    : null;
  const sharedSubmissions = slot.shared >= 0 ? rowsOf<{ count: number }>(secondBatch[slot.shared])[0] ?? null : null;
  const notificationRows = rowsOf<{ id: string; type: string; title: string; body: string; createdAt: string }>(secondBatch[slot.notifications]);

  let permission = basePermission;
  let hunterEliminatedIds: string[] = [];
  if (phase?.status === 'PENDING_HUNTER') {
    const outcome = proposal ? JSON.parse(proposal.outcomeJson) as PhaseResolution : null;
    hunterEliminatedIds = outcome?.eliminations.map((elimination) => elimination.playerId) ?? [];
    if (!outcome?.hunterRequiredIds.includes(player.id)) {
      permission = { actionKind: null, maxTargets: 0, label: 'Waiting for the Hunter' };
    }
  }
  if (phase?.status === 'PENDING_APPROVAL' || (!alive && !permission.actionKind)) {
    permission = { actionKind: null, maxTargets: 0, label: alive ? 'Waiting for moderator review' : 'Spectating the village' };
  }
  if (player.gameStatus === 'STOPPED') {
    permission = { actionKind: null, maxTargets: 0, label: 'This game has been stopped by a moderator.' };
  }
  // Batch 2 read these for the permission before the Hunter check; drop them if it took the action away.
  const currentAction = permission.actionKind ? fetchedAction : null;
  const sharedCount = permission.actionKind ? Number(sharedSubmissions?.count ?? 0) : 0;

  const { livingPlayers, eliminatedPlayers, werewolvesRemaining } = publicRoster(roster);
  const candidates = permission.actionKind
    ? roster
        .filter((seat) => seat.alive && (permission.actionKind === 'CUPID_PAIR' || seat.id !== player.id))
        .filter((seat) => permission.actionKind !== 'WOLF_VOTE' || seat.role !== 'WEREWOLF')
        .filter((seat) => permission.actionKind !== 'HUNTER_SHOT' || !hunterEliminatedIds.includes(seat.id))
        .map(({ id, displayName }) => ({ id, displayName: id === player.id ? `${displayName} (you)` : displayName }))
    : [];
  const teammates = player.role === 'WEREWOLF' || player.role === 'MASON'
    ? roster
        .filter((seat) => seat.id !== player.id && seat.role === player.role)
        .map(({ id, displayName, alive: teammateAlive }) => ({ id, displayName, alive: teammateAlive }))
    : [];
  const participation = participationCounter({
    actionKind: phase ? permission.actionKind : null,
    livingPlayers: livingPlayers.length,
    livingWerewolves: werewolvesRemaining,
    eliminatedPlayers: eliminatedPlayers.length,
    sharedSubmissions: sharedCount,
    ownSubmission: Boolean(currentAction),
  });

  const { timeline, timelineHasMore } = buildTimeline(
    { timelineRows: rowsOf<TimelineRow>(timelineResult), newestBallotRows: rowsOf<PublicVoteRow>(newestBallotResult), ballotCountRows: rowsOf<{ phaseId: string; count: number }>(ballotCountResult) },
    roster,
    player.id,
  );

  const notificationsHasMore = notificationRows.length === NOTIFICATION_LIMIT;
  const lastNotification = notificationRows.at(-1);

  return {
    player: {
      id: player.id,
      displayName: player.displayName,
      alive,
      role: player.role,
      roleDefinition: player.role ? ROLE_CATALOG[player.role] : null,
      teammates,
    },
    game: {
      id: gameId,
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
    timeline,
    timelineHasMore,
    // The player's own email switch. Absent from the choice when this site cannot send email.
    emailNotifications: { available: emailNotificationsAvailable(), enabled: Boolean(player.emailEnabled) },
    notifications: notificationRows,
    notificationsHasMore,
    notificationsNextCursor: notificationsHasMore && lastNotification ? { createdAt: lastNotification.createdAt, id: lastNotification.id } : null,
    rooms: roomRows,
  };
}

export type PlayerDashboardPayload = NonNullable<Awaited<ReturnType<typeof loadDashboard>>>;

/**
 * What a spectator sees: the same public view as any player (who is alive,
 * who was eliminated and their revealed role, the official timeline with its
 * published ballots) plus the Afterlife. A spectator has no role, no vote, and
 * no private results, so nothing here depends on a seat. Returns null when the
 * spectator does not exist.
 */
export async function loadSpectatorDashboard(spectatorId: string, options: { automation?: Automation } = {}) {
  const db = getDb();
  const { automation } = options;
  const due = automation ? automaticStepDueAt(automation.game, automation.phase) : null;
  const spectator = await db
    .prepare(
      `SELECT sp.id, sp.display_name AS displayName, g.id AS gameId, g.name AS gameName,
              g.status AS gameStatus, g.timezone, g.stop_reason AS stopReason
       FROM spectators sp JOIN games g ON g.id = sp.game_id
       WHERE sp.id = ? AND sp.status = 'ACTIVE' LIMIT 1`,
    )
    .bind(spectatorId)
    .first<{ id: string; displayName: string; gameId: string; gameName: string; gameStatus: string; timezone: string; stopReason: string | null }>();
  if (!spectator) return null;
  const gameId = spectator.gameId;

  const [phaseResult, rosterResult, timelineResult, newestBallotResult, ballotCountResult, publicRoomsResult] = await db.batch([
    currentPhaseStatement(gameId),
    rosterStatement(gameId),
    ...publicTimelineStatements(gameId),
    db
      .prepare("SELECT id, type, status FROM chat_rooms WHERE game_id = ? AND type IN ('DEAD', 'TOWN_HALL') AND status != 'PURGED' ORDER BY type")
      .bind(gameId),
  ], 'read');
  const phase = rowsOf<CurrentPhaseRow>(phaseResult)[0] ?? null;
  const roster = rosterFromRows(rowsOf<RosterRow>(rosterResult));
  const publicRooms = rowsOf<{ id: string; type: 'DEAD' | 'TOWN_HALL'; status: string }>(publicRoomsResult);
  const afterlife = publicRooms.find((room) => room.type === 'DEAD');
  const townHall = publicRooms.find((room) => room.type === 'TOWN_HALL');
  const { livingPlayers, eliminatedPlayers, werewolvesRemaining } = publicRoster(roster);
  // How many living players have voted on an open Day or Final ballot, as every voter sees. Night counts stay private.
  const openBallot = phase?.status === 'OPEN' && phase.kind !== 'NIGHT';
  const dayVotes = openBallot
    ? await db
        .prepare(
          `SELECT COUNT(DISTINCT actor_seat_id) AS count FROM action_submissions
           WHERE phase_id = ? AND kind = 'DAY_VOTE' AND superseded_at IS NULL`,
        )
        .bind(phase.id)
        .first<{ count: number }>()
    : null;
  const { timeline, timelineHasMore } = buildTimeline(
    { timelineRows: rowsOf<TimelineRow>(timelineResult), newestBallotRows: rowsOf<PublicVoteRow>(newestBallotResult), ballotCountRows: rowsOf<{ phaseId: string; count: number }>(ballotCountResult) },
    roster,
    null,
  );
  const canPost = afterlife ? spectatorCanPost(spectator.gameStatus, afterlife.status) : false;

  return {
    viewer: 'SPECTATOR' as const,
    player: {
      id: spectator.id,
      displayName: spectator.displayName,
      alive: false,
      role: null as RoleKey | null,
      roleDefinition: null,
      teammates: [] as Array<{ id: string; displayName: string; alive: boolean }>,
    },
    game: {
      id: gameId,
      name: spectator.gameName,
      status: spectator.gameStatus,
      timezone: spectator.timezone,
      stopReason: spectator.stopReason,
      automationPaused: Boolean(automation?.game.pausedAt),
      counts: { total: roster.length, living: livingPlayers.length, werewolvesRemaining },
      livingPlayers,
      eliminatedPlayers,
    },
    phase: phase
      ? {
          ...phase,
          deadline: phase.status === 'PENDING_HUNTER' ? phase.hunterDeadlineAt : phase.closesAt,
          autoPublishAt: due?.kind === 'PUBLISH' && automation?.phase?.id === phase.id ? due.at : null,
        }
      : null,
    permission: { actionKind: null as ActionKind | null, maxTargets: 0, label: 'Spectating the village' },
    candidates: [] as Array<{ id: string; displayName: string }>,
    currentAction: null,
    participation: openBallot
      ? { submitted: Math.min(Number(dayVotes?.count ?? 0), livingPlayers.length), eligible: livingPlayers.length }
      : { submitted: 0, eligible: 0 },
    timeline,
    timelineHasMore,
    notifications: [] as Array<{ id: string; type: string; title: string; body: string; createdAt: string }>,
    notificationsHasMore: false,
    notificationsNextCursor: null,
    // Spectators post in the Afterlife and only read the Town Hall.
    rooms: [
      ...(afterlife ? [{ id: afterlife.id, type: 'DEAD' as const, status: afterlife.status, access: canPost ? 'WRITE' : 'READ_ONLY' }] : []),
      ...(townHall ? [{ id: townHall.id, type: 'TOWN_HALL' as const, status: townHall.status, access: 'READ_ONLY' }] : []),
    ],
  };
}
