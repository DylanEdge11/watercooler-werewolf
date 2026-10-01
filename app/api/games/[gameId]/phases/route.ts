import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { parseEliminationSchedule, phaseSlots } from '../../../../../lib/game/elimination-schedule';
import { validateFinalShowdownEntry, validatePhaseOpen } from '../../../../../lib/game/phase-policy';
import { automaticStepDueAt } from '../../../../../lib/game/automation';
import { advanceGameSafely } from '../../../../../lib/game/automation-sweep';
import { outstandingResponders } from '../../../../../lib/game/outstanding';
import { applyEliminationOverride } from '../../../../../lib/game/engine';
import { changes, loadActions, overrideIdsFromJson } from '../../../../../lib/game/phase-store';
import { runPhaseAction } from '../../../../../lib/game/phase-transitions';
import { loadCurrentLoverPair } from '../../../../../lib/game/relationships';
import { parseScheduledDate } from '../../../../../lib/game/scheduling';
import { canonicalRoleKey, type PhaseKind, type PhaseResolution, type PlayerState } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { notifyPhaseOpened, runAfterResponse } from '../../../../../lib/notify/notifications';
import { HttpError, routeError } from '../../../../../lib/http/errors';
import { respondJsonWithEtag } from '../../../../../lib/http/etag';

// Player email is sent after the response, within this function's time limit: a result story, then up to 80 emails.
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ gameId: string }>;
}

interface PhaseRow {
  id: string;
  sequence: number;
  kind: PhaseKind;
  status: string;
  opensAt: string;
  closesAt: string;
  slots: number;
  hunterDeadlineAt: string | null;
  publishedAt: string | null;
  currentSubmissions: number;
  afterlifeSubmissions: number;
}

interface ProposalRow {
  id: string;
  phaseId: string;
  status: string;
  outcomeJson: string;
  randomRollsJson: string;
  overrideReason: string | null;
  overrideJson: string | null;
  reviewedByModeratorId: string | null;
  reviewedAt: string | null;
  reviewedOutcomeJson: string | null;
  publishedOutcomeJson: string | null;
  createdAt: string;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    // The console's ten-second refresh also applies any automatic step that is due.
    const automation = await advanceGameSafely(gameId);
    const db = getDb();
    const [gameRow, phaseRows, proposalRows, reviewRows, rosterRows] = await Promise.all([
      db.prepare(`SELECT status, final_cutoff_at AS finalCutoffAt, timezone, updated_at AS updatedAt,
                publication_mode AS publicationMode, review_window_minutes AS reviewWindowMinutes,
                automation_paused_at AS automationPausedAt, elimination_schedule_json AS eliminationScheduleJson
         FROM games WHERE id = ? LIMIT 1`).bind(gameId).first<{ status: string; finalCutoffAt: string; timezone: string; updatedAt: string; publicationMode: string; reviewWindowMinutes: number; automationPausedAt: string | null; eliminationScheduleJson: string | null }>(),
      db
        .prepare(
          `SELECT p.id, p.sequence, p.kind, p.status, p.opens_at AS opensAt, p.closes_at AS closesAt,
                  p.slots, p.hunter_deadline_at AS hunterDeadlineAt, p.published_at AS publishedAt,
                  COUNT(CASE WHEN a.kind != 'AFTERLIFE_VOTE' THEN a.id END) AS currentSubmissions,
                  COUNT(CASE WHEN a.kind = 'AFTERLIFE_VOTE' THEN a.id END) AS afterlifeSubmissions
           FROM phases p
           LEFT JOIN action_submissions a ON a.phase_id = p.id AND a.superseded_at IS NULL
           WHERE p.game_id = ? GROUP BY p.id ORDER BY p.sequence DESC`,
        )
        .bind(gameId)
        .all<PhaseRow>(),
      // Full results only for the phases the console can show: any phase not yet
      // published, and the newest phase. Older phases get a summary (below).
      db
        .prepare(
          `SELECT rp.id, rp.phase_id AS phaseId, rp.status, rp.outcome_json AS outcomeJson,
                  rp.random_rolls_json AS randomRollsJson, rp.override_reason AS overrideReason,
                  rp.override_json AS overrideJson,
                  rp.reviewed_by_moderator_id AS reviewedByModeratorId, rp.reviewed_at AS reviewedAt,
                  rp.reviewed_outcome_json AS reviewedOutcomeJson,
                  rp.published_outcome_json AS publishedOutcomeJson,
                  rp.created_at AS createdAt
           FROM resolution_proposals rp JOIN phases p ON p.id = rp.phase_id
           WHERE p.game_id = ?
             AND (p.status NOT IN ('PUBLISHED', 'SUPERSEDED') OR p.sequence = (SELECT MAX(sequence) FROM phases WHERE game_id = ?))
           ORDER BY rp.created_at DESC`,
        )
        .bind(gameId, gameId)
        .all<ProposalRow>(),
      db
        .prepare(
          `SELECT rp.phase_id AS phaseId, rp.reviewed_by_moderator_id AS reviewedByModeratorId
           FROM resolution_proposals rp JOIN phases p ON p.id = rp.phase_id
           WHERE p.game_id = ? ORDER BY rp.created_at DESC`,
        )
        .bind(gameId)
        .all<{ phaseId: string; reviewedByModeratorId: string | null }>(),
      db
        .prepare(
          `SELECT s.id, s.display_name AS displayName, s.alive, ra.role_key AS role
           FROM seats s JOIN role_assignments ra ON ra.seat_id = s.id AND ra.game_id = s.game_id
           WHERE s.game_id = ? AND s.status = 'CLAIMED' ORDER BY s.display_name COLLATE NOCASE`,
        )
        .bind(gameId)
        .all(),
    ]);
    const proposalByPhase = new Map<string, ProposalRow>();
    for (const proposal of proposalRows.results) {
      if (!proposalByPhase.has(proposal.phaseId)) proposalByPhase.set(proposal.phaseId, proposal);
    }
    // The latest proposal of every phase, for the "published automatically" mark.
    const reviewByPhase = new Map<string, { reviewedByModeratorId: string | null }>();
    for (const review of reviewRows.results) {
      if (!reviewByPhase.has(review.phaseId)) reviewByPhase.set(review.phaseId, review);
    }
    const rosterPlayers: PlayerState[] = rosterRows.results.map((row) => ({
      id: String(row.id),
      displayName: String(row.displayName),
      role: canonicalRoleKey(String(row.role)),
      alive: Boolean(row.alive),
    }));
    // Only the open phase has anyone outstanding. Names are for the moderator console only.
    const openPhase = phaseRows.results.find((phase) => phase.status === 'OPEN');
    const outstanding = openPhase
      ? outstandingResponders({
          phase: { kind: openPhase.kind, status: openPhase.status },
          players: rosterPlayers,
          actions: await loadActions(openPhase.id),
          cupidPairExists: Boolean(await loadCurrentLoverPair(gameId)),
        }).map(({ id, displayName }) => ({ id, displayName }))
      : [];
    return respondJsonWithEtag(request, {
      ok: true,
      game: gameRow
        ? { ...gameRow, eliminationScheduleJson: undefined, eliminationSchedule: parseEliminationSchedule(gameRow.eliminationScheduleJson) }
        : null,
      // The next automatic step and when it happens, or null in review mode, while paused, or when nothing is pending.
      nextAutomaticStep: automation ? automaticStepDueAt(automation.game, automation.phase) : null,
      roster: rosterRows.results.map((row) => ({ ...row, role: canonicalRoleKey(String(row.role)) })),
      phases: phaseRows.results.map((phase) => {
        const proposal = proposalByPhase.get(phase.id);
        const proposedOutcome = proposal ? JSON.parse(proposal.outcomeJson) as PhaseResolution : null;
        const overrideIds = proposal ? overrideIdsFromJson(proposal.overrideJson) : null;
        const reviewedOutcome = proposal?.reviewedOutcomeJson
          ? JSON.parse(proposal.reviewedOutcomeJson) as PhaseResolution
          : proposedOutcome && overrideIds
            ? applyEliminationOverride(proposedOutcome, overrideIds, rosterPlayers)
            : null;
        const publishedOutcome = proposal?.publishedOutcomeJson
          ? JSON.parse(proposal.publishedOutcomeJson) as PhaseResolution
          : null;
        return {
          ...phase,
          currentSubmissions: Number(phase.currentSubmissions),
          afterlifeSubmissions: Number(phase.afterlifeSubmissions),
          outstanding: phase.id === openPhase?.id ? outstanding : [],
          // Published with no moderator attached: the sweep published it after the review window.
          publishedAutomatically: phase.status === 'PUBLISHED' && reviewByPhase.has(phase.id) && !reviewByPhase.get(phase.id)?.reviewedByModeratorId,
          // Older published phases are summaries: the console shows only the newest or unpublished phase's result.
          proposal: proposal
             ? {
                 ...proposal,
                 proposedOutcome,
                 reviewedOutcome,
                 publishedOutcome,
                 outcome: publishedOutcome ?? reviewedOutcome ?? proposedOutcome,
                 outcomeJson: undefined,
                 overrideJson: undefined,
                 reviewedOutcomeJson: undefined,
                 publishedOutcomeJson: undefined,
               }
            : null,
        };
      }),
    });
  } catch (error) {
    return routeError(error, 'Unable to load phases.');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const body = (await request.json()) as {
      action?: 'OPEN' | 'ENTER_FINAL_SHOWDOWN' | 'LOCK_AND_PROPOSE' | 'FINALIZE_HUNTER' | 'PUBLISH';
      phaseId?: string;
      kind?: PhaseKind;
      closesAt?: string;
      skipHunter?: boolean;
      overrideReason?: string;
      overrideEliminationIds?: string[];
    };
    const db = getDb();
    const game = await db
      .prepare(
        `SELECT status, day_divisor AS dayDivisor, night_divisor AS nightDivisor,
                hunter_window_minutes AS hunterWindowMinutes,
                final_cutoff_at AS finalCutoffAt, timezone,
                elimination_schedule_json AS eliminationScheduleJson
         FROM games WHERE id = ? LIMIT 1`,
      )
      .bind(gameId)
      .first<{ status: string; dayDivisor: number; nightDivisor: number; hunterWindowMinutes: number; finalCutoffAt: string; timezone: string; eliminationScheduleJson: string | null }>();
    if (!game) throw new HttpError(404, 'Game not found.');

    if (body.action === 'ENTER_FINAL_SHOWDOWN') {
      if (game.status === 'FINAL_SHOWDOWN') return Response.json({ ok: true, idempotent: true, status: game.status });
      const latest = await db
        .prepare('SELECT kind, status FROM phases WHERE game_id = ? ORDER BY sequence DESC LIMIT 1')
        .bind(gameId)
        .first<{ kind: PhaseKind; status: string }>();
      // A final ballot that produced a winner completes the game, so the policy's game-status check covers it.
      const latestEntry = latest ? { kind: latest.kind, status: latest.status } : null;
      const policyError = validateFinalShowdownEntry({
        gameStatus: game.status,
        latestPhase: latestEntry,
        finalCutoffAt: game.finalCutoffAt,
        now: new Date(),
      });
      if (policyError) throw new Error(policyError);
      const now = new Date().toISOString();
      const result = await db.batch([
        db.prepare("UPDATE games SET status = 'FINAL_SHOWDOWN', updated_at = ? WHERE id = ? AND status = 'ACTIVE'").bind(now, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, 'FINAL_SHOWDOWN_ENTERED', ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status = 'FINAL_SHOWDOWN' AND updated_at = ?)`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ finalCutoffAt: game.finalCutoffAt }), now, gameId, now),
      ]);
      if (changes(result[0]) !== 1) return jsonError('The game changed before final showdown could begin. Refresh and review its current state.', 409);
      return Response.json({ ok: true, status: 'FINAL_SHOWDOWN' });
    }

    if (body.action === 'OPEN') {
      if (!body.kind || !['DAY', 'NIGHT', 'FINAL_BALLOT'].includes(body.kind)) throw new Error('Choose a valid phase kind.');
      const closesAt = parseScheduledDate(body.closesAt ?? '', game.timezone);
      if (Number.isNaN(closesAt.valueOf()) || closesAt <= new Date()) throw new Error('The phase deadline must be in the future.');
      const blocking = await db
        .prepare(
          `SELECT id, kind, status, closes_at AS closesAt FROM phases WHERE game_id = ?
           AND status IN ('OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL') LIMIT 1`,
        )
        .bind(gameId)
        .first<{ id: string; kind: PhaseKind; status: string; closesAt: string }>();
      if (blocking) {
        if (blocking.status === 'OPEN' && blocking.kind === body.kind) {
          return Response.json({ ok: true, idempotent: true, phaseId: blocking.id });
        }
        throw new Error('Finish the current phase before opening another.');
      }
      const latest = await db
        .prepare('SELECT kind, status FROM phases WHERE game_id = ? ORDER BY sequence DESC LIMIT 1')
        .bind(gameId)
        .first<{ kind: PhaseKind; status: string }>();
      // A final ballot that produced a winner completes the game, so the policy's game-status check covers it.
      const latestEntry = latest ? { kind: latest.kind, status: latest.status } : null;
      const policyError = validatePhaseOpen({ gameStatus: game.status, latestPhase: latestEntry, requestedKind: body.kind });
      if (policyError) throw new Error(policyError);
      const living = await db
        .prepare("SELECT COUNT(*) AS count FROM seats WHERE game_id = ? AND status = 'CLAIMED' AND alive = 1")
        .bind(gameId)
        .first<{ count: number }>();
      const sequenceRow = await db
        .prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM phases WHERE game_id = ?')
        .bind(gameId)
        .first<{ sequence: number }>();
      const sequence = Number(sequenceRow?.sequence ?? 0) + 1;
      const divisor = body.kind === 'NIGHT' ? Number(game.nightDivisor) : Number(game.dayDivisor);
      // Days and Nights follow the elimination schedule when the game has one; otherwise the divisor.
      const slots = phaseSlots({
        kind: body.kind,
        sequence,
        livingPlayers: Number(living?.count ?? 0),
        dayDivisor: Number(game.dayDivisor),
        nightDivisor: Number(game.nightDivisor),
        schedule: parseEliminationSchedule(game.eliminationScheduleJson),
      });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const result = await db.batch([
        db
          .prepare(
            `INSERT INTO phases
             (id, game_id, sequence, kind, status, opens_at, closes_at, slots, divisor_snapshot, version, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, 1, ?, ?
             WHERE EXISTS (
                 SELECT 1 FROM games WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN')
                   -- A schedule saved since it was read answers 409, so the slots never use a stale schedule.
                   AND elimination_schedule_json IS ?
               )
               AND NOT EXISTS (
                 SELECT 1 FROM phases
                 WHERE game_id = ? AND status IN ('OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL', 'HUNTER_FINALIZING', 'PUBLISHING')
               )`,
          )
          .bind(id, gameId, sequence, body.kind, now, closesAt.toISOString(), slots, divisor, now, now, gameId, game.eliminationScheduleJson ?? null, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, ?, 'PHASE_OPENED', ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM phases p JOIN games g ON g.id = p.game_id
                           WHERE p.id = ? AND p.status = 'OPEN' AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN'))`,
          )
          .bind(crypto.randomUUID(), gameId, id, moderator.id, JSON.stringify({ kind: body.kind, slots, closesAt: closesAt.toISOString() }), now, id),
      ]);
      if (changes(result[0]) !== 1) return jsonError('The game or current phase changed before this phase could open. Refresh and try again.', 409);
      // Players who turned email on and have something to do are told after this response is sent.
      runAfterResponse(() => notifyPhaseOpened(gameId, id));
      return Response.json({ ok: true, phaseId: id, slots });
    }

    const result = await runPhaseAction(gameId, game, { moderatorId: moderator.id, source: 'MODERATOR' }, body);
    return result.status === 200 ? Response.json(result.body) : jsonError(result.error, result.status);
  } catch (error) {
    return routeError(error, 'Unable to update the phase.');
  }
}
