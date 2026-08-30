import { getD1 } from '../../../../../db';
import { ensureDatabase } from '../../../../../db/migrate';
import { requireGameModerator } from '../../../../../lib/auth/authorization';
import { sha256 } from '../../../../../lib/auth/crypto';
import { calculateEliminationSlots } from '../../../../../lib/game/balance';
import { evaluateWinner, resolveHunterShot, resolvePhase } from '../../../../../lib/game/engine';
import { validateFinalShowdownEntry, validatePhaseOpen } from '../../../../../lib/game/phase-policy';
import { createSecureRandomRolls } from '../../../../../lib/game/random';
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
  createdAt: string;
}

async function loadPlayers(gameId: string): Promise<PlayerState[]> {
  const rows = await getD1()
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
  const rows = await getD1()
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
    const db = getD1();
    const [gameRow, phaseRows, proposalRows, rosterRows] = await Promise.all([
      db.prepare('SELECT status, final_cutoff_at AS finalCutoffAt, timezone FROM games WHERE id = ? LIMIT 1').bind(gameId).first<{ status: string; finalCutoffAt: string; timezone: string }>(),
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
    return Response.json({
      ok: true,
      game: gameRow,
      roster: rosterRows.results.map((row) => ({ ...row, role: canonicalRoleKey(String(row.role)) })),
      phases: phaseRows.results.map((phase) => {
        const proposal = proposalByPhase.get(phase.id);
        return {
          ...phase,
          currentSubmissions: Number(phase.currentSubmissions),
          proposal: proposal
            ? { ...proposal, outcome: JSON.parse(proposal.outcomeJson) as PhaseResolution, outcomeJson: undefined }
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
    const db = getD1();
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
      await db.batch([
        db.prepare("UPDATE games SET status = 'FINAL_SHOWDOWN', updated_at = ? WHERE id = ? AND status = 'ACTIVE'").bind(now, gameId),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, 'FINAL_SHOWDOWN_ENTERED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, moderator.id, JSON.stringify({ finalCutoffAt: game.finalCutoffAt }), now),
      ]);
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
      await db.batch([
        db
          .prepare(
            `INSERT INTO phases
             (id, game_id, sequence, kind, status, opens_at, closes_at, slots, divisor_snapshot, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, gameId, Number(sequenceRow?.sequence ?? 0) + 1, body.kind, now, closesAt.toISOString(), slots, divisor, now, now),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, ?, 'PHASE_OPENED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, id, moderator.id, JSON.stringify({ kind: body.kind, slots, closesAt: closesAt.toISOString() }), now),
      ]);
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
      return Response.json({ ok: true, idempotent: true });
    }

    if (body.action === 'LOCK_AND_PROPOSE') {
      const players = await loadPlayers(gameId);
      const actions = await loadActions(phase.id);
      const randomRolls = createSecureRandomRolls(Number(phase.slots));
      const outcome = resolvePhase({
        phaseId: phase.id,
        kind: phase.kind,
        slots: Number(phase.slots),
        players,
        actions,
        randomRolls,
      });
      const inputHash = await sha256(JSON.stringify({ phase, players, actions }));
      const proposalId = crypto.randomUUID();
      const now = new Date();
      const hunterDeadline = outcome.hunterRequiredIds.length
        ? new Date(now.valueOf() + Number(game.hunterWindowMinutes) * 60_000).toISOString()
        : null;
      await db.batch([
        db
          .prepare(
            `INSERT INTO resolution_proposals
             (id, phase_id, input_hash, engine_version, outcome_json, random_rolls_json, status, created_at)
             VALUES (?, ?, ?, '1.0.0', ?, ?, 'PROPOSED', ?)`,
          )
          .bind(proposalId, phase.id, inputHash, JSON.stringify(outcome), JSON.stringify(randomRolls), now.toISOString()),
        db
          .prepare(
            `UPDATE phases SET status = ?, hunter_deadline_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('OPEN', 'LOCKED')`,
          )
          .bind(outcome.hunterRequiredIds.length ? 'PENDING_HUNTER' : 'PENDING_APPROVAL', hunterDeadline, now.toISOString(), phase.id),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, ?, 'RESOLUTION_PROPOSED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ proposalId, inputHash }), now.toISOString()),
      ]);
      return Response.json({ ok: true, proposalId, outcome, hunterDeadline });
    }

    const proposal = await db
      .prepare(
        `SELECT id, outcome_json AS outcomeJson FROM resolution_proposals
         WHERE phase_id = ? AND status = 'PROPOSED' ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(phase.id)
      .first<{ id: string; outcomeJson: string }>();
    if (!proposal) throw new Error('No pending resolution exists for this phase.');

    if (body.action === 'FINALIZE_HUNTER') {
      if (phase.status !== 'PENDING_HUNTER') throw new Error('This phase is not waiting for a Hunter.');
      const players = await loadPlayers(gameId);
      const currentOutcome = JSON.parse(proposal.outcomeJson) as PhaseResolution;
      const actions = await loadActions(phase.id);
      const hunterAction = actions.find((action) => action.kind === 'HUNTER_SHOT');
      let outcome: PhaseResolution;
      if (hunterAction) {
        outcome = resolveHunterShot({ players, resolution: currentOutcome, hunterAction });
      } else {
        const deadlinePassed = phase.hunterDeadlineAt && new Date(phase.hunterDeadlineAt) <= new Date();
        if (!body.skipHunter || !deadlinePassed) throw new Error('The Hunter has not submitted and their response window is still open.');
        outcome = {
          ...currentOutcome,
          hunterRequiredIds: [],
          warnings: [...currentOutcome.warnings, { actionId: 'hunter-timeout', reason: 'Hunter response window expired without a shot.' }],
        };
      }
      const now = new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE resolution_proposals SET outcome_json = ? WHERE id = ? AND status = 'PROPOSED'").bind(JSON.stringify(outcome), proposal.id),
        db.prepare("UPDATE phases SET status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ?").bind(now, phase.id),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, ?, 'HUNTER_RESOLVED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ submitted: Boolean(hunterAction) }), now),
      ]);
      return Response.json({ ok: true, outcome });
    }

    if (body.action === 'PUBLISH') {
      if (phase.status !== 'PENDING_APPROVAL') throw new Error('This phase is not ready for publication.');
      const players = await loadPlayers(gameId);
      let outcome = JSON.parse(proposal.outcomeJson) as PhaseResolution;
      const isOverride = body.overrideEliminationIds !== undefined;
      if (isOverride) {
        const reason = body.overrideReason?.trim() ?? '';
        if (reason.length < 10) throw new Error('An override requires a reason of at least 10 characters.');
        const ids = [...new Set(body.overrideEliminationIds)];
        const livingIds = new Set(players.filter((player) => player.alive).map((player) => player.id));
        if (ids.length > Number(phase.slots) + 1 || ids.some((id) => !livingIds.has(id))) {
          throw new Error('Override eliminations must be living players within the phase limit.');
        }
        outcome = {
          ...outcome,
          eliminations: ids.map((playerId) => ({
            playerId,
            cause: phase.kind === 'NIGHT' ? 'WEREWOLF_ATTACK' : 'DAY_VOTE',
          })),
          hunterRequiredIds: [],
        };
      }
      const now = new Date().toISOString();
      const eliminated = outcome.eliminations.map((elimination) => {
        const player = players.find((candidate) => candidate.id === elimination.playerId);
        if (!player) throw new Error('Resolution references a player outside this game.');
        return { ...elimination, displayName: player.displayName, role: player.role };
      });
      const win = evaluateWinner(players, outcome.eliminations);
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE resolution_proposals
             SET status = ?, override_reason = ?, override_json = ?, reviewed_by_moderator_id = ?, reviewed_at = ?
             WHERE id = ? AND status = 'PROPOSED'`,
          )
          .bind(
            isOverride ? 'OVERRIDDEN' : 'APPROVED',
            isOverride ? body.overrideReason?.trim() : null,
            isOverride ? JSON.stringify({ eliminationIds: body.overrideEliminationIds }) : null,
            moderator.id,
            now,
            proposal.id,
          ),
        db.prepare("UPDATE phases SET status = 'PUBLISHED', published_at = ?, updated_at = ? WHERE id = ?").bind(now, now, phase.id),
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             VALUES (?, ?, ?, 'PHASE_PUBLISHED', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ kind: phase.kind, eliminations: eliminated, winner: win.winner }), now),
      ];
      for (const elimination of eliminated) {
        statements.push(
          db.prepare('UPDATE seats SET alive = 0, updated_at = ? WHERE id = ?').bind(now, elimination.playerId),
          db.prepare('UPDATE role_assignments SET revealed_at = ? WHERE game_id = ? AND seat_id = ?').bind(now, gameId, elimination.playerId),
        );
      }
      for (const investigation of outcome.investigations) {
        const target = players.find((player) => player.id === investigation.targetId);
        statements.push(
          db
            .prepare(
              `INSERT INTO notifications (id, seat_id, type, title, body, created_at)
               VALUES (?, ?, 'INVESTIGATION_RESULT', 'Your vision is clear', ?, ?)`,
            )
            .bind(crypto.randomUUID(), investigation.seerId, `${target?.displayName ?? 'That player'} is the ${investigation.role}.`, now),
        );
      }
      if (win.winner) {
        statements.push(
          db.prepare("UPDATE games SET status = 'COMPLETED', updated_at = ? WHERE id = ?").bind(now, gameId),
          db.prepare("UPDATE chat_rooms SET status = 'READ_ONLY' WHERE game_id = ? AND status = 'OPEN'").bind(gameId),
          db
            .prepare(
              `INSERT INTO game_events
               (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
               VALUES (?, ?, ?, 'GAME_COMPLETED', ?, ?, ?)`,
            )
            .bind(crypto.randomUUID(), gameId, phase.id, moderator.id, JSON.stringify({ winner: win.winner }), now),
        );
      }
      await db.batch(statements);
      await ensureGameRooms(gameId);
      return Response.json({ ok: true, outcome, eliminated, winner: win.winner });
    }

    throw new Error('Unknown phase action.');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unable to update the phase.', 400);
  }
}
