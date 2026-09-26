import { getDb } from '../../db';
import { sha256 } from '../auth/crypto';
import { ensureGameRooms } from '../chat/rooms';
import { evaluateWinner, resolveHunterShot, resolvePhase } from './engine';
import { applyEliminationOverride, changes, loadActions, loadPlayers, overrideIdsFromJson } from './phase-store';
import { createSecureRandomRolls } from './random';
import { loadCurrentLoverPair } from './relationships';
import type { PhaseKind, PhaseResolution } from './types';

/**
 * Lock-and-calculate, Hunter follow-up, and publication for one phase.
 *
 * This code moved here unchanged from app/api/games/[gameId]/phases/route.ts
 * so the moderator's buttons and the automatic sweep (lib/game/automation.ts)
 * run exactly the same transitions with the same conditional writes. A
 * moderator action records the moderator; an automatic one records no
 * moderator and the SCHEDULER source.
 */

export type TransitionActor =
  | { moderatorId: string; source: 'MODERATOR' }
  | { moderatorId: null; source: 'SCHEDULER' };

export interface PhaseActionGame {
  status: string;
  hunterWindowMinutes: number;
}

export interface PhaseActionBody {
  action?: string;
  phaseId?: string;
  skipHunter?: boolean;
  overrideReason?: string;
  overrideEliminationIds?: string[];
}

export interface AutomaticPublication {
  /** Only a phase that has waited for review since at or before this instant may publish. */
  reviewCutoff: string;
}

export type PhaseActionResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 409; error: string };

function done(body: Record<string, unknown>): PhaseActionResult {
  return { status: 200, body };
}

function conflict(error: string): PhaseActionResult {
  return { status: 409, error };
}

/**
 * Runs LOCK_AND_PROPOSE, FINALIZE_HUNTER, or PUBLISH. Invalid requests throw
 * (the route answers 400); a lost race returns a 409 result.
 */
export async function runPhaseAction(
  gameId: string,
  game: PhaseActionGame,
  actor: TransitionActor,
  body: PhaseActionBody,
  automatic?: AutomaticPublication,
): Promise<PhaseActionResult> {
  const db = getDb();
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
      if (existing) return done({ ok: true, idempotent: true, proposalId: existing.id, outcome: JSON.parse(existing.outcomeJson) as PhaseResolution });
    }
    throw new Error('Only an open phase can be locked.');
  }
  if (body.action === 'FINALIZE_HUNTER' && (phase.status === 'PENDING_APPROVAL' || phase.status === 'PUBLISHED')) {
    const existing = await db
      .prepare("SELECT outcome_json AS outcomeJson FROM resolution_proposals WHERE phase_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(phase.id)
      .first<{ outcomeJson: string }>();
    if (existing) return done({ ok: true, idempotent: true, outcome: JSON.parse(existing.outcomeJson) as PhaseResolution });
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
    return done({
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
          return conflict('The phase changed before responses could be locked. Refresh and try again.');
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
    if (!lockedPhase) return conflict('The phase is no longer available for resolution. Refresh and try again.');
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
        .bind(crypto.randomUUID(), gameId, phase.id, actor.moderatorId, JSON.stringify({ proposalId, inputHash }), now.toISOString(), proposalId, phase.id, phase.id),
    ]);
    if (changes(result[0]) !== 1) {
      const existing = await db
        .prepare("SELECT id, outcome_json AS outcomeJson FROM resolution_proposals WHERE phase_id = ? ORDER BY created_at DESC LIMIT 1")
        .bind(phase.id)
        .first<{ id: string; outcomeJson: string }>();
      if (existing) return done({ ok: true, idempotent: true, proposalId: existing.id, outcome: JSON.parse(existing.outcomeJson) as PhaseResolution });
      return conflict('The phase was stopped or changed before its resolution could be recorded. Refresh and try again.');
    }
    return done({ ok: true, proposalId, outcome, hunterDeadline });
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
    if (changes(claim) !== 1) return conflict('The Hunter follow-up or game changed before it could be finalized. Refresh and try again.');
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
        .bind(crypto.randomUUID(), gameId, phase.id, actor.moderatorId, JSON.stringify({ submitted: Boolean(hunterAction) }), now, phase.id, gameId, claimVersion),
      db.prepare(`UPDATE phases SET status = 'PENDING_APPROVAL', updated_at = ? WHERE id = ? AND game_id = ? AND status = 'HUNTER_FINALIZING' AND version = ? AND ${finalizeGuard}`).bind(now, phase.id, gameId, claimVersion, phase.id, gameId, claimVersion),
    ]);
    if (changes(result[0]) !== 1) return conflict('The Hunter follow-up changed before it could be recorded. Refresh and try again.');
    return done({ ok: true, outcome });
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
          .bind(overrideReason, overrideJson, actor.moderatorId, now, JSON.stringify(outcome), proposal.id, phase.id, phase.id, gameId),
        // Record the follow-up before the phase transition invalidates handoffGuard.
        db
          .prepare(
            `INSERT INTO game_events
             (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
             SELECT ?, ?, ?, 'HUNTER_FOLLOWUP_REQUIRED', ?, ?, ?
             WHERE ${handoffGuard}`,
          )
          .bind(crypto.randomUUID(), gameId, phase.id, actor.moderatorId, JSON.stringify({ source: 'OVERRIDE', hunterIds: outcome.hunterRequiredIds, overrideReason }), now, phase.id, gameId),
        db
          .prepare(
            `UPDATE phases SET status = 'PENDING_HUNTER', hunter_deadline_at = ?, updated_at = ?
             WHERE id = ? AND game_id = ? AND status = 'PENDING_APPROVAL' AND ${handoffGuard}`,
          )
          .bind(hunterDeadline, now, phase.id, gameId, phase.id, gameId),
      ]);
      if (changes(result[0]) !== 1) return conflict('The phase changed before the override could be recorded. Refresh and try again.');
      return done({ ok: true, pendingHunter: true, outcome, proposedOutcome, hunterDeadline, overrideReason, reviewedByModeratorId: actor.moderatorId, reviewedAt: now });
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
          actor.moderatorId,
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
        .bind(crypto.randomUUID(), gameId, phase.id, actor.moderatorId, JSON.stringify({ kind: phase.kind, proposedOutcome, publishedOutcome: outcome, eliminations: eliminated, winner: win.winner, overrideReason }), now, phase.id, gameId, claimedVersion),
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
          .bind(crypto.randomUUID(), gameId, phase.id, actor.moderatorId, JSON.stringify({ winner: win.winner }), now, phase.id, gameId, claimedVersion),
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
        return done({ ok: true, idempotent: true, outcome: publishedOutcome, proposedOutcome: JSON.parse(current.outcomeJson) as PhaseResolution, reviewedOutcome: current.reviewedOutcomeJson ? JSON.parse(current.reviewedOutcomeJson) as PhaseResolution : null, publishedOutcome, overrideReason: current.overrideReason, reviewedByModeratorId: current.reviewedByModeratorId, reviewedAt: current.reviewedAt, winner: evaluateWinner(players, publishedOutcome.eliminations).winner });
      }
      return conflict('The phase was changed before publication could commit. Refresh and review the authoritative result.');
    }
    await ensureGameRooms(gameId);
    return done({ ok: true, outcome, proposedOutcome, reviewedOutcome: outcome, publishedOutcome: outcome, eliminated, winner: win.winner, overrideReason, reviewedByModeratorId: actor.moderatorId, reviewedAt: now });
  }

  throw new Error('Unknown phase action.');
}
