import { getDb } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { sha256 } from '../../../../../lib/auth/crypto';
import { calculateEliminationSlots } from '../../../../../lib/game/balance';
import { evaluateWinner, resolveHunterShot, resolvePhase } from '../../../../../lib/game/engine';
import { validateFinalShowdownEntry, validatePhaseOpen } from '../../../../../lib/game/phase-policy';
import { createSecureRandomRolls } from '../../../../../lib/game/random';
import { outstandingResponders } from '../../../../../lib/game/outstanding';
import { loadCurrentLoverPair } from '../../../../../lib/game/relationships';
import { parseScheduledDate } from '../../../../../lib/game/scheduling';
import { canonicalRoleKey, type ActionSubmission, type PhaseKind, type PhaseResolution, type PlayerState, type RoleKey } from '../../../../../lib/game/types';
import { assertSameOrigin, jsonError } from '../../../../../lib/http/security';
import { ensureGameRooms } from '../../../../../lib/chat/rooms';

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

function overrideIdsFromJson(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { eliminationIds?: unknown };
    return Array.isArray(parsed.eliminationIds)
      ? parsed.eliminationIds.filter((id): id is string => typeof id === 'string')
      : null;
  } catch {
    throw new Error('The stored moderation override is invalid.');
  }
}

/** Apply a saved review override without replacing the original engine result. */
function applyEliminationOverride(
  proposedOutcome: PhaseResolution,
  ids: string[],
  players: PlayerState[],
): PhaseResolution {
  const cause = proposedOutcome.kind === 'NIGHT' ? 'WEREWOLF_ATTACK' : 'DAY_VOTE';
  const eliminations: PhaseResolution['eliminations'] = ids.map((playerId) => ({ playerId, cause }));
  const loverPair = proposedOutcome.loverPair;
  if (loverPair) {
    const eliminatedIds = new Set(eliminations.map((item) => item.playerId));
    const [first, second] = loverPair.playerIds;
    if (eliminatedIds.has(first) && !eliminatedIds.has(second)) eliminations.push({ playerId: second, cause: 'LOVER_BOND' });
    else if (eliminatedIds.has(second) && !eliminatedIds.has(first)) eliminations.push({ playerId: first, cause: 'LOVER_BOND' });
  }
  return {
    ...proposedOutcome,
    selectedTargets: ids,
    eliminations,
    hunterRequiredIds: eliminations
      .filter((item) => players.find((player) => player.id === item.playerId)?.role === 'HUNTER')
      .map((item) => item.playerId),
  };
}

function changes(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}

async function loadPlayers(gameId: string): Promise<PlayerState[]> {
  const rows = await getDb()
    .prepare(
      `SELECT s.id, s.display_name AS displayName, ra.role_key AS role, s.alive
       FROM seats s JOIN role_assignments ra ON ra.seat_id = s.id AND ra.game_id = s.game_id
       WHERE s.game_id = ? AND s.status = 'CLAIMED' ORDER BY s.id`,
    )
    .bind(gameId)
    .all<{ id: string; displayName: string; role: RoleKey; alive: number }>();
  return rows.results.map((row) => ({ ...row, role: canonicalRoleKey(row.role), alive: Boolean(row.alive) }));
}

async function loadActions(phaseId: string): Promise<ActionSubmission[]> {
  const rows = await getDb()
    .prepare(
      `SELECT id, actor_seat_id AS actorId, kind, target_ids_json AS targetIdsJson,
              submitted_at AS submittedAt, version
       FROM action_submissions WHERE phase_id = ? AND superseded_at IS NULL ORDER BY submitted_at`,
    )
    .bind(phaseId)
    .all<{ id: string; actorId: string; kind: ActionSubmission['kind']; targetIdsJson: string; submittedAt: string; version: number }>();
  return rows.results.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    kind: row.kind,
    targetIds: JSON.parse(row.targetIdsJson) as string[],
    submittedAt: row.submittedAt,
    version: Number(row.version),
  }));
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureDatabase();
    const { gameId } = await context.params;
    await requireGameModerator(gameId);
    const db = getDb();
    const [gameRow, phaseRows, proposalRows, rosterRows] = await Promise.all([
      db.prepare('SELECT status, final_cutoff_at AS finalCutoffAt, timezone, updated_at AS updatedAt FROM games WHERE id = ? LIMIT 1').bind(gameId).first<{ status: string; finalCutoffAt: string; timezone: string; updatedAt: string }>(),
      db
        .prepare(
          `SELECT p.id, p.sequence, p.kind, p.status, p.opens_at AS opensAt, p.closes_at AS closesAt,
                  p.slots, p.hunter_deadline_at AS hunterDeadlineAt, p.published_at AS publishedAt,
                  COUNT(a.id) AS currentSubmissions
           FROM phases p
           LEFT JOIN action_submissions a ON a.phase_id = p.id AND a.superseded_at IS NULL
           WHERE p.game_id = ? GROUP BY p.id ORDER BY p.sequence DESC`,
        )
        .bind(gameId)
        .all<PhaseRow>(),
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
           WHERE p.game_id = ? ORDER BY rp.created_at DESC`,
        )
        .bind(gameId)
        .all<ProposalRow>(),
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
    return Response.json({
      ok: true,
      game: gameRow,
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
          outstanding: phase.id === openPhase?.id ? outstanding : [],
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
    return jsonError(error instanceof Error ? error.message : 'Unable to load phases.', 401);
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
                final_cutoff_at AS finalCutoffAt, timezone
         FROM games WHERE id = ? LIMIT 1`,
      )
      .bind(gameId)
      .first<{ status: string; dayDivisor: number; nightDivisor: number; hunterWindowMinutes: number; finalCutoffAt: string; timezone: string }>();
    if (!game) throw new Error('Game not found.');

    if (body.action === 'ENTER_FINAL_SHOWDOWN') {
      if (game.status === 'FINAL_SHOWDOWN') return Response.json({ ok: true, idempotent: true, status: game.status });
      const latest = await db
        .prepare(
          `SELECT p.kind, p.status, rp.outcome_json AS outcomeJson
           FROM phases p LEFT JOIN resolution_proposals rp ON rp.phase_id = p.id
           WHERE p.game_id = ? ORDER BY p.sequence DESC, rp.created_at DESC LIMIT 1`,
        )
        .bind(gameId)
        .first<{ kind: PhaseKind; status: string; outcomeJson: string | null }>();
      const latestEntry = latest
        ? {
            kind: latest.kind,
            status: latest.status,
            winner: null,
          }
        : null;
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
        .prepare(
          `SELECT p.kind, p.status, rp.outcome_json AS outcomeJson
           FROM phases p LEFT JOIN resolution_proposals rp ON rp.phase_id = p.id
           WHERE p.game_id = ? ORDER BY p.sequence DESC, rp.created_at DESC LIMIT 1`,
        )
        .bind(gameId)
        .first<{ kind: PhaseKind; status: string; outcomeJson: string | null }>();
      const latestEntry = latest
        ? {
            kind: latest.kind,
            status: latest.status,
            winner: null,
          }
        : null;
      const policyError = validatePhaseOpen({ gameStatus: game.status, latestPhase: latestEntry, requestedKind: body.kind });
      if (policyError) throw new Error(policyError);
      const living = await db
        .prepare("SELECT COUNT(*) AS count FROM seats WHERE game_id = ? AND status = 'CLAIMED' AND alive = 1")
        .bind(gameId)
        .first<{ count: number }>();
      const divisor = body.kind === 'NIGHT' ? Number(game.nightDivisor) : Number(game.dayDivisor);
      const slots = calculateEliminationSlots(Number(living?.count ?? 0), divisor);
      const sequenceRow = await db
        .prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM phases WHERE game_id = ?')
        .bind(gameId)
        .first<{ sequence: number }>();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const result = await db.batch([
        db
          .prepare(
            `INSERT INTO phases
             (id, game_id, sequence, kind, status, opens_at, closes_at, slots, divisor_snapshot, version, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, 1, ?, ?
             WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN'))
               AND NOT EXISTS (
                 SELECT 1 FROM phases
                 WHERE game_id = ? AND status IN ('OPEN', 'LOCKED', 'PENDING_HUNTER', 'PENDING_APPROVAL', 'HUNTER_FINALIZING', 'PUBLISHING')
               )`,
          )
          .bind(id, gameId, Number(sequenceRow?.sequence ?? 0) + 1, body.kind, now, closesAt.toISOString(), slots, divisor, now, now, gameId, gameId),
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
      return Response.json({ ok: true, phaseId: id, slots });
    }

    if (!body.phaseId) throw new Error('Choose a phase.');
    const phase = await db
      .prepare(
        `SELECT id, kind, status, slots, version, hunter_deadline_at AS hunterDeadlineAt
         FROM phases WHERE id = ? AND game_id = ? LIMIT 1`,
      )
      .bind(body.phaseId, gameId)
      .first<{ id: string; kind: PhaseKind; status: string; slots: number; version: number; hunterDeadlineAt: string | null }>();
    if (!phase) throw new Error('Phase not found.');

    if (body.action === 'LOCK_AND_PROPOSE' && !['OPEN', 'LOCKED'].includes(phase.status)) {
      if (phase.status === 'PENDING_HUNTER' || phase.status === 'PENDING_APPROVAL' || phase.status === 'PUBLISHED') {
        const existing = await db
          .prepare("SELECT id, outcome_json AS outcomeJson FROM resolution_proposals WHERE phase_id = ? ORDER BY created_at DESC LIMIT 1")
          .bind(phase.id)
          .first<{ id: string; outcomeJson: string }>();
        if (existing) return Response.json({ ok: true, idempotent: true, proposalId: existing.id, outcome: JSON.parse(existing.outcomeJson) as PhaseResolution });
      }
      throw new Error('Only an open phase can be locked.');
    }
    if (body.action === 'FINALIZE_HUNTER' && (phase.status === 'PENDING_APPROVAL' || phase.status === 'PUBLISHED')) {
      const existing = await db
        .prepare("SELECT outcome_json AS outcomeJson FROM resolution_proposals WHERE phase_id = ? ORDER BY created_at DESC LIMIT 1")
        .bind(phase.id)
        .first<{ outcomeJson: string }>();
      if (existing) return Response.json({ ok: true, idempotent: true, outcome: JSON.parse(existing.outcomeJson) as PhaseResolution });
    }
    if (body.action === 'PUBLISH' && phase.status === 'PUBLISHED') {
      const committed = await db
        .prepare(
          `SELECT id, outcome_json AS outcomeJson, published_outcome_json AS publishedOutcomeJson,
                  override_reason AS overrideReason,
                  reviewed_by_moderator_id AS reviewedByModeratorId, reviewed_at AS reviewedAt,
                  reviewed_outcome_json AS reviewedOutcomeJson
           FROM resolution_proposals WHERE phase_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(phase.id)
        .first<{ id: string; outcomeJson: string; publishedOutcomeJson: string | null; overrideReason: string | null; reviewedByModeratorId: string | null; reviewedAt: string | null; reviewedOutcomeJson: string | null }>();
      const publishedOutcome = committed?.publishedOutcomeJson
        ? JSON.parse(committed.publishedOutcomeJson) as PhaseResolution
        : committed ? JSON.parse(committed.outcomeJson) as PhaseResolution : null;
      return Response.json({
        ok: true,
        idempotent: true,
        proposalId: committed?.id,
        proposedOutcome: committed ? JSON.parse(committed.outcomeJson) as PhaseResolution : null,
        reviewedOutcome: committed?.reviewedOutcomeJson ? JSON.parse(committed.reviewedOutcomeJson) as PhaseResolution : null,
        publishedOutcome,
        outcome: publishedOutcome,
        overrideReason: committed?.overrideReason ?? null,
        reviewedByModeratorId: committed?.reviewedByModeratorId ?? null,
        reviewedAt: committed?.reviewedAt ?? null,
      });
    }

    if (body.action === 'LOCK_AND_PROPOSE') {
      if (phase.status === 'OPEN') {
        // Lock before reading the resolution input. The provider serializes this update
        // with action submissions and Stop, so a successful late submission is
        // either committed before this claim (and included below) or rejected
        // after it.
        const lockResult = await db
          .prepare(
            `UPDATE phases SET status = 'LOCKED', version = version + 1, updated_at = ?
             WHERE id = ? AND game_id = ? AND status = 'OPEN'`,
          )
          .bind(new Date().toISOString(), phase.id, gameId)
          .run();
        if (changes(lockResult) !== 1) {
          const current = await db.prepare('SELECT status FROM phases WHERE id = ? AND game_id = ? LIMIT 1').bind(phase.id, gameId).first<{ status: string }>();
          if (!current || !['LOCKED'].includes(current.status)) {
            return jsonError('The phase changed before responses could be locked. Refresh and try again.', 409);
          }
        }
      }
      const players = await loadPlayers(gameId);
      const actions = await loadActions(phase.id);
      const loverPair = await loadCurrentLoverPair(gameId);
      const lockedPhase = await db
        .prepare('SELECT version FROM phases WHERE id = ? AND game_id = ? AND status = \'LOCKED\' LIMIT 1')
        .bind(phase.id, gameId)
        .first<{ version: number }>();
      if (!lockedPhase) return jsonError('The phase is no longer available for resolution. Refresh and try again.', 409);
      const randomRolls = createSecureRandomRolls(Number(phase.slots));
      const outcome = resolvePhase({
        phaseId: phase.id,
        kind: phase.kind,
        slots: Number(phase.slots),
        players,
        actions,
        randomRolls,
        loverPair,
      });
      const inputHash = await sha256(JSON.stringify({ phaseId: phase.id, version: Number(lockedPhase.version), kind: phase.kind, slots: phase.slots, players, actions, loverPair }));
      const proposalId = crypto.randomUUID();
      const now = new Date();
      const hunterDeadline = outcome.hunterRequiredIds.length
        ? new Date(now.valueOf() + Number(game.hunterWindowMinutes) * 60_000).toISOString()
        : null;
      const result = await db.batch([
        db
          .prepare(
            `INSERT INTO resolution_proposals
             (id, phase_id, input_hash, engine_version, outcome_json, random_rolls_json, status, created_at)
             SELECT ?, ?, ?, '1.0.0', ?, ?, 'PROPOSED', ?
             WHERE EXISTS (
               SELECT 1 FROM phases p JOIN games g ON g.id = p.game_id
               WHERE p.id = ? AND p.game_id = ? AND p.status = 'LOCKED'
                 AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')
             )
             AND NOT EXISTS (SELECT 1 FROM resolution_proposals existing WHERE existing.phase_id = ? AND existing.input_hash = ?)`,
          )
          .bind(proposalId, phase.id, inputHash, JSON.stringify(outcome), JSON.stringify(randomRolls), now.toISOString(), phase.id, gameId, phase.id, inputHash),
        db
          .prepare(
            `UPDATE phases SET status = ?, hunter_deadline_at = ?, updated_at = ?
             WHERE id = ? AND game_id = ? AND status = 'LOCKED'
               AND EXISTS (SELECT 1 FROM resolution_proposals WHERE id = ? AND phase_id = ?)
               AND EXISTS (SELECT 1 FROM games WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN'))`,
          )
          .bind(outcome.hunterRequiredIds.length ? 'PENDING_HUNTER' : 'PENDING_APPROVAL', hunterDeadline, now.toISOString(), phase.id, gameId, proposalId, phase.id, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, ?, 'RESOLUTION_PROPOSED', ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM resolution_proposals WHERE id = ? AND phase_id = ?)
               AND EXISTS (SELECT 1 FROM phases WHERE id = ? AND status IN ('PENDING_HUNTER', 'PENDING_APPROVAL'))`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ proposalId, inputHash }), now.toISOString(), proposalId, phase.id, phase.id),
      ]);
      if (changes(result[0]) !== 1) {
        const existing = await db
          .prepare("SELECT id, outcome_json AS outcomeJson FROM resolution_proposals WHERE phase_id = ? ORDER BY created_at DESC LIMIT 1")
          .bind(phase.id)
          .first<{ id: string; outcomeJson: string }>();
        if (existing) return Response.json({ ok: true, idempotent: true, proposalId: existing.id, outcome: JSON.parse(existing.outcomeJson) as PhaseResolution });
        return jsonError('The phase was stopped or changed before its resolution could be recorded. Refresh and try again.', 409);
      }
      return Response.json({ ok: true, proposalId, outcome, hunterDeadline });
    }

    const proposal = await db
      .prepare(
          `SELECT id, outcome_json AS outcomeJson, override_reason AS overrideReason,
                override_json AS overrideJson, status,
                reviewed_by_moderator_id AS reviewedByModeratorId, reviewed_at AS reviewedAt,
                reviewed_outcome_json AS reviewedOutcomeJson,
                published_outcome_json AS publishedOutcomeJson
         FROM resolution_proposals
         WHERE phase_id = ? AND status = 'PROPOSED' ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(phase.id)
      .first<{ id: string; outcomeJson: string; overrideReason: string | null; overrideJson: string | null; status: string; reviewedByModeratorId: string | null; reviewedAt: string | null; reviewedOutcomeJson: string | null; publishedOutcomeJson: string | null }>();
    if (!proposal) throw new Error('No pending resolution exists for this phase.');

    if (body.action === 'FINALIZE_HUNTER') {
      if (phase.status !== 'PENDING_HUNTER') throw new Error('This phase is not waiting for a Hunter.');
      const deadlinePassed = Boolean(phase.hunterDeadlineAt && new Date(phase.hunterDeadlineAt) <= new Date());
      const initialActions = await loadActions(phase.id);
      const initialHunterAction = initialActions.find((action) => action.kind === 'HUNTER_SHOT');
      if (!initialHunterAction && (!body.skipHunter || !deadlinePassed)) {
        throw new Error('The Hunter has not submitted and their response window is still open.');
      }
      const claimVersion = Number(phase.version) + 1;
      const claim = await db
        .prepare(
          `UPDATE phases SET status = 'HUNTER_FINALIZING', version = version + 1, updated_at = ?
           WHERE id = ? AND game_id = ? AND status = 'PENDING_HUNTER' AND version = ?
             AND EXISTS (SELECT 1 FROM games WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN'))
             AND EXISTS (SELECT 1 FROM resolution_proposals WHERE id = ? AND status = 'PROPOSED')`,
        )
        .bind(new Date().toISOString(), phase.id, gameId, phase.version, gameId, proposal.id)
        .run();
      if (changes(claim) !== 1) return jsonError('The Hunter follow-up or game changed before it could be finalized. Refresh and try again.', 409);
      const players = await loadPlayers(gameId);
      const proposedOutcome = JSON.parse(proposal.outcomeJson) as PhaseResolution;
      const storedOverrideIds = overrideIdsFromJson(proposal.overrideJson);
      const currentOutcome = proposal.reviewedOutcomeJson
        ? JSON.parse(proposal.reviewedOutcomeJson) as PhaseResolution
        : storedOverrideIds
          ? applyEliminationOverride(proposedOutcome, storedOverrideIds, players)
          : proposedOutcome;
      const actions = await loadActions(phase.id);
      const hunterAction = actions.find((action) => action.kind === 'HUNTER_SHOT');
      let outcome: PhaseResolution;
      if (hunterAction) {
        outcome = resolveHunterShot({ players, resolution: currentOutcome, hunterAction });
      } else {
        if (!body.skipHunter || !deadlinePassed) {
          await db.prepare("UPDATE phases SET status = 'PENDING_HUNTER', updated_at = ? WHERE id = ? AND status = 'HUNTER_FINALIZING' AND version = ?").bind(new Date().toISOString(), phase.id, claimVersion).run();
          throw new Error('The Hunter has not submitted and their response window is still open.');
        }
        outcome = {
          ...currentOutcome,
          hunterRequiredIds: [],
          warnings: [...currentOutcome.warnings, { actionId: 'hunter-timeout', reason: 'Hunter response window expired without a shot.' }],
        };
      }
      const now = new Date().toISOString();
      const finalizeGuard = `EXISTS (
        SELECT 1 FROM phases p JOIN games g ON g.id = p.game_id
        WHERE p.id = ? AND p.game_id = ? AND p.status = 'HUNTER_FINALIZING' AND p.version = ?
          AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')
      )`;
      const result = await db.batch([
        db.prepare(`UPDATE resolution_proposals SET reviewed_outcome_json = ? WHERE id = ? AND status = 'PROPOSED' AND ${finalizeGuard}`).bind(JSON.stringify(outcome), proposal.id, phase.id, gameId, claimVersion),
        // Record the resolution before the phase transition invalidates finalizeGuard.
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, ?, 'HUNTER_RESOLVED', ?, ?, ? WHERE ${finalizeGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ submitted: Boolean(hunterAction) }), now, phase.id, gameId, claimVersion),
        db.prepare(`UPDATE phases SET status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ? AND game_id = ? AND status = 'HUNTER_FINALIZING' AND version = ? AND ${finalizeGuard}`).bind(now, phase.id, gameId, claimVersion, phase.id, gameId, claimVersion),
      ]);
      if (changes(result[0]) !== 1) return jsonError('The Hunter follow-up changed before it could be recorded. Refresh and try again.', 409);
      return Response.json({ ok: true, outcome });
    }

    if (body.action === 'PUBLISH') {
      if (phase.status !== 'PENDING_APPROVAL') throw new Error('This phase is not ready for publication.');
      const players = await loadPlayers(gameId);
      const currentLoverPair = await loadCurrentLoverPair(gameId);
      const proposedOutcome = JSON.parse(proposal.outcomeJson) as PhaseResolution;
      const storedOverrideIds = overrideIdsFromJson(proposal.overrideJson);
      let outcome = proposal.reviewedOutcomeJson
        ? JSON.parse(proposal.reviewedOutcomeJson) as PhaseResolution
        : storedOverrideIds
          ? applyEliminationOverride(proposedOutcome, storedOverrideIds, players)
          : proposedOutcome;
      const isOverride = body.overrideEliminationIds !== undefined;
      let overrideReason = proposal.overrideReason;
      let overrideJson = proposal.overrideJson;
      if (isOverride) {
        const reason = body.overrideReason?.trim() ?? '';
        if (reason.length < 10) throw new Error('An override requires a reason of at least 10 characters.');
        const ids = [...new Set((body.overrideEliminationIds ?? []).filter((id): id is string => typeof id === 'string'))];
        const livingIds = new Set(players.filter((player) => player.alive).map((player) => player.id));
        if (ids.length > Number(phase.slots) + 1 || ids.some((id) => !livingIds.has(id))) {
          throw new Error('Override eliminations must be living players within the phase limit.');
        }
        outcome = applyEliminationOverride(proposedOutcome, ids, players);
        overrideReason = reason;
        overrideJson = JSON.stringify({ eliminationIds: ids });
      }
      const now = new Date().toISOString();
      if (outcome.hunterRequiredIds.length > 0) {
        const hunterDeadline = new Date(Date.now() + Number(game.hunterWindowMinutes) * 60_000).toISOString();
        const handoffGuard = `EXISTS (
          SELECT 1 FROM phases p JOIN games g ON g.id = p.game_id
          WHERE p.id = ? AND p.game_id = ? AND p.status = 'PENDING_APPROVAL'
            AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')
        )`;
        const result = await db.batch([
          db
            .prepare(
              `UPDATE resolution_proposals
               SET override_reason = ?, override_json = ?,
                   reviewed_by_moderator_id = ?, reviewed_at = ?, reviewed_outcome_json = ?
               WHERE id = ? AND phase_id = ? AND status = 'PROPOSED' AND ${handoffGuard}`,
            )
            .bind(overrideReason, overrideJson, moderator.id, now, JSON.stringify(outcome), proposal.id, phase.id, phase.id, gameId),
          // Record the follow-up before the phase transition invalidates handoffGuard.
          db
            .prepare(
              `INSERT INTO game_events
               (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
               SELECT ?, ?, ?, 'HUNTER_FOLLOWUP_REQUIRED', ?, ?, ?
               WHERE ${handoffGuard}`,
            )
            .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ source: 'OVERRIDE', hunterIds: outcome.hunterRequiredIds, overrideReason }), now, phase.id, gameId),
          db
            .prepare(
              `UPDATE phases SET status = 'PENDING_HUNTER', hunter_deadline_at = ?, updated_at = ?
               WHERE id = ? AND game_id = ? AND status = 'PENDING_APPROVAL' AND ${handoffGuard}`,
            )
            .bind(hunterDeadline, now, phase.id, gameId, phase.id, gameId),
        ]);
        if (changes(result[0]) !== 1) return jsonError('The phase changed before the override could be recorded. Refresh and try again.', 409);
        return Response.json({ ok: true, pendingHunter: true, outcome, proposedOutcome, hunterDeadline, overrideReason, reviewedByModeratorId: moderator.id, reviewedAt: now });
      }
      const eliminated = outcome.eliminations.map((elimination) => {
        const player = players.find((candidate) => candidate.id === elimination.playerId);
        if (!player) throw new Error('Resolution references a player outside this game.');
        return { ...elimination, displayName: player.displayName, role: player.role };
      });
      const win = evaluateWinner(players, outcome.eliminations);
      const claimedVersion = Number(phase.version) + 1;
      const publicationGuard = `EXISTS (
        SELECT 1 FROM phases p
        WHERE p.id = ? AND p.game_id = ? AND p.status = 'PUBLISHING' AND p.version = ?
      )`;
      const statements = [
        // The PUBLISHING status is the authoritative one-phase claim. Since
        // this statement and all dependent statements are one provider batch, Stop
        // and a competing publication cannot interleave with the effects.
        db
          .prepare(
            `UPDATE phases SET status = 'PUBLISHING', version = version + 1, updated_at = ?
             WHERE id = ? AND game_id = ? AND status = 'PENDING_APPROVAL' AND version = ?
               AND EXISTS (SELECT 1 FROM games WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN'))
               AND EXISTS (SELECT 1 FROM resolution_proposals WHERE id = ? AND phase_id = ? AND status = 'PROPOSED')`,
          )
          .bind(now, phase.id, gameId, phase.version, gameId, proposal.id, phase.id),
        db
          .prepare(
            `UPDATE resolution_proposals
             SET status = ?, override_reason = ?, override_json = ?, reviewed_by_moderator_id = ?, reviewed_at = ?,
                 reviewed_outcome_json = ?, published_outcome_json = ?
             WHERE id = ? AND phase_id = ? AND status = 'PROPOSED' AND ${publicationGuard}`,
          )
          .bind(
            overrideReason ? 'OVERRIDDEN' : 'APPROVED',
            overrideReason,
            overrideJson,
            moderator.id,
            now,
            JSON.stringify(outcome),
            JSON.stringify(outcome),
            proposal.id,
            phase.id,
            phase.id,
            gameId,
            claimedVersion,
          ),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, ?, 'PHASE_PUBLISHED', ?, ?, ? WHERE ${publicationGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ kind: phase.kind, proposedOutcome, publishedOutcome: outcome, eliminations: eliminated, winner: win.winner, overrideReason }), now, phase.id, gameId, claimedVersion),
      ];
      if (!currentLoverPair && outcome.loverPair) {
        statements.push(
          db
            .prepare(
              `INSERT INTO game_events
               (id, game_id, phase_id, event_type, actor_seat_id, payload_json, created_at)
               SELECT ?, ?, ?, 'CUPID_PAIR_SET', ?, ?, ? WHERE ${publicationGuard}`,
            )
            .bind(crypto.randomUUID(), gameId, phase.id, outcome.loverPair.cupidId, JSON.stringify(outcome.loverPair), now, phase.id, gameId, claimedVersion),
        );
        const notificationBodies = new Map<string, { title: string; body: string }>();
        const [firstId, secondId] = outcome.loverPair.playerIds;
        const firstName = players.find((player) => player.id === firstId)?.displayName ?? 'your partner';
        const secondName = players.find((player) => player.id === secondId)?.displayName ?? 'your partner';
        notificationBodies.set(firstId, { title: 'Cupid has linked you', body: `You and ${secondName} are lovers. If either of you is eliminated, both of you will die.` });
        notificationBodies.set(secondId, { title: 'Cupid has linked you', body: `You and ${firstName} are lovers. If either of you is eliminated, both of you will die.` });
        if (outcome.loverPair.cupidId !== firstId && outcome.loverPair.cupidId !== secondId) {
          notificationBodies.set(outcome.loverPair.cupidId, { title: 'Your pairing is set', body: `${firstName} and ${secondName} are lovers. If either is eliminated, both will die.` });
        }
        for (const [seatId, notification] of notificationBodies) {
          statements.push(
            db
              .prepare(
                `INSERT INTO notifications (id, seat_id, type, title, body, created_at)
                 SELECT ?, ?, 'LOVER_BOND', ?, ?, ? WHERE ${publicationGuard}`,
              )
              .bind(crypto.randomUUID(), seatId, notification.title, notification.body, now, phase.id, gameId, claimedVersion),
          );
        }
      }
      for (const elimination of eliminated) {
        statements.push(
          db
            .prepare(`UPDATE seats SET alive = 0, updated_at = ? WHERE id = ? AND game_id = ? AND ${publicationGuard}`)
            .bind(now, elimination.playerId, gameId, phase.id, gameId, claimedVersion),
          db
            .prepare(`UPDATE role_assignments SET revealed_at = ? WHERE game_id = ? AND seat_id = ? AND ${publicationGuard}`)
            .bind(now, gameId, elimination.playerId, phase.id, gameId, claimedVersion),
        );
      }
      for (const investigation of outcome.investigations) {
        const target = players.find((player) => player.id === investigation.targetId);
        statements.push(
          db
            .prepare(
              `INSERT INTO notifications (id, seat_id, type, title, body, created_at)
               SELECT ?, ?, 'INVESTIGATION_RESULT', 'Your vision is clear', ?, ? WHERE ${publicationGuard}`,
            )
            .bind(crypto.randomUUID(), investigation.seerId, `${target?.displayName ?? 'That player'} is the ${investigation.role}.`, now, phase.id, gameId, claimedVersion),
        );
      }
      if (win.winner) {
        statements.push(
          db
            .prepare(`UPDATE games SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN') AND ${publicationGuard}`)
            .bind(now, gameId, phase.id, gameId, claimedVersion),
          db
            .prepare(`UPDATE chat_rooms SET status = 'READ_ONLY' WHERE game_id = ? AND status = 'OPEN' AND ${publicationGuard}`)
            .bind(gameId, phase.id, gameId, claimedVersion),
          db
            .prepare(
              `INSERT INTO game_events
               (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
               SELECT ?, ?, ?, 'GAME_COMPLETED', ?, ?, ? WHERE ${publicationGuard}`,
            )
            .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ winner: win.winner }), now, phase.id, gameId, claimedVersion),
        );
      } else {
        statements.push(
          db
            .prepare(`UPDATE games SET updated_at = ? WHERE id = ? AND status IN ('ACTIVE', 'FINAL_SHOWDOWN') AND ${publicationGuard}`)
            .bind(now, gameId, phase.id, gameId, claimedVersion),
        );
      }
      statements.push(
        db
          .prepare("UPDATE phases SET status = 'PUBLISHED', published_at = ?, updated_at = ? WHERE id = ? AND game_id = ? AND status = 'PUBLISHING' AND version = ?")
          .bind(now, now, phase.id, gameId, claimedVersion),
      );
      const result = await db.batch(statements);
      if (changes(result[0]) !== 1) {
        const current = await db
          .prepare(
            `SELECT p.status, rp.published_outcome_json AS publishedOutcomeJson,
                    rp.outcome_json AS outcomeJson, rp.override_reason AS overrideReason,
                    rp.reviewed_by_moderator_id AS reviewedByModeratorId, rp.reviewed_at AS reviewedAt,
                    rp.reviewed_outcome_json AS reviewedOutcomeJson
             FROM phases p LEFT JOIN resolution_proposals rp ON rp.id = ?
             WHERE p.id = ? AND p.game_id = ? LIMIT 1`,
          )
          .bind(proposal.id, phase.id, gameId)
          .first<{ status: string; publishedOutcomeJson: string | null; outcomeJson: string; overrideReason: string | null; reviewedByModeratorId: string | null; reviewedAt: string | null; reviewedOutcomeJson: string | null }>();
        if (current?.status === 'PUBLISHED' && current.publishedOutcomeJson) {
          const publishedOutcome = JSON.parse(current.publishedOutcomeJson) as PhaseResolution;
          return Response.json({ ok: true, idempotent: true, outcome: publishedOutcome, proposedOutcome: JSON.parse(current.outcomeJson) as PhaseResolution, reviewedOutcome: current.reviewedOutcomeJson ? JSON.parse(current.reviewedOutcomeJson) as PhaseResolution : null, publishedOutcome, overrideReason: current.overrideReason, reviewedByModeratorId: current.reviewedByModeratorId, reviewedAt: current.reviewedAt, winner: evaluateWinner(players, publishedOutcome.eliminations).winner });
        }
        return jsonError('The phase was changed before publication could commit. Refresh and review the authoritative result.', 409);
      }
      await ensureGameRooms(gameId);
      return Response.json({ ok: true, outcome, proposedOutcome, reviewedOutcome: outcome, publishedOutcome: outcome, eliminated, winner: win.winner, overrideReason, reviewedByModeratorId: moderator.id, reviewedAt: now });
    }

    throw new Error('Unknown phase action.');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update the phase.', 400);
  }
}
