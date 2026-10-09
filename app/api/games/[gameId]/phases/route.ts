import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { parseEliminationSchedule } from '@/lib/game/elimination-schedule';
import { validateDeadlineExtension, validateFinalShowdownEntry } from '@/lib/game/phase-policy';
import { automaticStepDueAt } from '@/lib/game/automation';
import { advanceGameSafely } from '@/lib/game/automation-sweep';
import { outstandingResponders } from '@/lib/game/outstanding';
import { applyEliminationOverride } from '@/lib/game/engine';
import { changes, loadActions, overrideIdsFromJson } from '@/lib/game/phase-store';
import { openPhase } from '@/lib/game/phase-open';
import { runPhaseAction } from '@/lib/game/phase-transitions';
import { loadCurrentLoverPair } from '@/lib/game/relationships';
import { parseCloseSchedule, parseScheduledDate } from '@/lib/game/scheduling';
import { canonicalRoleKey, type PhaseKind, type PhaseResolution, type PlayerState } from '@/lib/game/types';
import { assertSameOrigin, jsonError } from '@/lib/http/security';
import { HttpError, routeError } from '@/lib/http/errors';
import { respondJsonWithEtag } from '@/lib/http/etag';
import type { RouteContext } from '@/lib/http/route-context';

// Player email is sent after the response, within this function's time limit: a result story, then up to 80 emails.
export const maxDuration = 60;

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
  hunterShots: number;
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
                automation_paused_at AS automationPausedAt, elimination_schedule_json AS eliminationScheduleJson,
                schedule_json AS scheduleJson, active_weekdays_json AS activeWeekdaysJson,
                auto_open_next_phase AS autoOpenNextPhase
         FROM games WHERE id = ? LIMIT 1`).bind(gameId).first<{ status: string; finalCutoffAt: string; timezone: string; updatedAt: string; publicationMode: string; reviewWindowMinutes: number; automationPausedAt: string | null; eliminationScheduleJson: string | null; scheduleJson: string; activeWeekdaysJson: string; autoOpenNextPhase: number }>(),
      db
        .prepare(
          `SELECT p.id, p.sequence, p.kind, p.status, p.opens_at AS opensAt, p.closes_at AS closesAt,
                  p.slots, p.hunter_deadline_at AS hunterDeadlineAt, p.published_at AS publishedAt,
                  COUNT(CASE WHEN a.kind != 'AFTERLIFE_VOTE' THEN a.id END) AS currentSubmissions,
                  COUNT(CASE WHEN a.kind = 'AFTERLIFE_VOTE' THEN a.id END) AS afterlifeSubmissions,
                  COUNT(CASE WHEN a.kind = 'HUNTER_SHOT' THEN a.id END) AS hunterShots
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
        ? {
            ...gameRow,
            autoOpenNextPhase: Boolean(gameRow.autoOpenNextPhase),
            eliminationScheduleJson: undefined,
            eliminationSchedule: parseEliminationSchedule(gameRow.eliminationScheduleJson),
            scheduleJson: undefined,
            activeWeekdaysJson: undefined,
            // The Day and Night close times, so the console can suggest each phase's deadline.
            schedule: parseCloseSchedule(gameRow.scheduleJson, gameRow.activeWeekdaysJson),
          }
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
          hunterShotSaved: Number(phase.hunterShots) > 0,
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
      action?: 'OPEN' | 'EXTEND_DEADLINE' | 'ENTER_FINAL_SHOWDOWN' | 'LOCK_AND_PROPOSE' | 'FINALIZE_HUNTER' | 'PUBLISH';
      phaseId?: string;
      kind?: PhaseKind;
      closesAt?: string;
      skipHunter?: boolean;
      endHunterEarly?: boolean;
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

    if (body.action === 'EXTEND_DEADLINE') {
      if (!body.phaseId) throw new Error('Choose the open phase to extend.');
      const phase = await db
        .prepare('SELECT id, status, closes_at AS closesAt FROM phases WHERE id = ? AND game_id = ? LIMIT 1')
        .bind(body.phaseId, gameId)
        .first<{ id: string; status: string; closesAt: string }>();
      if (!phase) throw new HttpError(404, 'Phase not found.');
      const closesAt = parseScheduledDate(body.closesAt ?? '', game.timezone);
      const nowDate = new Date();
      const policyError = validateDeadlineExtension({
        gameStatus: game.status,
        phaseStatus: phase.status,
        currentClosesAt: phase.closesAt,
        requestedClosesAt: closesAt,
        now: nowDate,
      });
      if (policyError) throw new Error(policyError);
      const now = nowDate.toISOString();
      const result = await db.batch([
        // Still open, still the deadline that was read, and not yet passed; otherwise 409.
        // Clearing the reminder lets the closing-soon email go out before the new deadline.
        db
          .prepare(
            `UPDATE phases SET closes_at = ?, closing_reminder_at = NULL, version = version + 1, updated_at = ?
             WHERE id = ? AND game_id = ? AND status = 'OPEN' AND closes_at = ? AND closes_at > ?
               AND EXISTS (SELECT 1 FROM games WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN'))`,
          )
          .bind(closesAt.toISOString(), now, phase.id, gameId, phase.closesAt, now, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, ?, 'PHASE_DEADLINE_EXTENDED', ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM phases WHERE id = ? AND status = 'OPEN' AND closes_at = ? AND updated_at = ?)`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ from: phase.closesAt, to: closesAt.toISOString() }), now, phase.id, closesAt.toISOString(), now),
      ]);
      if (changes(result[0]) !== 1) return jsonError('The phase changed before its deadline could be extended. Refresh and try again.', 409);
      return Response.json({ ok: true, phaseId: phase.id, closesAt: closesAt.toISOString() });
    }

    if (body.action === 'OPEN') {
      if (!body.kind || !['DAY', 'NIGHT', 'FINAL_BALLOT'].includes(body.kind)) throw new Error('Choose a valid phase kind.');
      const result = await openPhase(gameId, { moderatorId: moderator.id, source: 'MODERATOR' }, body.kind, parseScheduledDate(body.closesAt ?? '', game.timezone));
      return result.status === 200 ? Response.json(result.body) : jsonError(result.error, result.status);
    }

    const result = await runPhaseAction(gameId, game, { moderatorId: moderator.id, source: 'MODERATOR' }, body);
    return result.status === 200 ? Response.json(result.body) : jsonError(result.error, result.status);
  } catch (error) {
    return routeError(error, 'Unable to update the phase.');
  }
}
