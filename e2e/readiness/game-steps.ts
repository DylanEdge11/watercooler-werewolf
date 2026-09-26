import { expect } from '@playwright/test';
import type { PhaseResolution } from '../../lib/game/types';
import type { BrowserGame, BrowserPlayer } from './browser-fixture';

// Day and Night steps shared by the browser readiness and UAT specs. Every
// vote and Night action is entered through each player's own browser page.

export async function refreshPlayers(game: BrowserGame): Promise<void> {
  for (const player of game.players) await player.reload();
}

export function livingTarget(game: BrowserGame, predicate: (player: BrowserPlayer) => boolean, actor?: BrowserPlayer): BrowserPlayer {
  return game.chooseLiving(predicate, actor);
}

export function fallbackVoteTarget(game: BrowserGame, actor: BrowserPlayer, preferred: BrowserPlayer): BrowserPlayer {
  return preferred.account.seatId === actor.account.seatId
    ? livingTarget(game, (player) => player.account.seatId !== actor.account.seatId, actor)
    : preferred;
}

export async function runDayElimination(
  game: BrowserGame,
  target: BrowserPlayer,
  options: { revise?: boolean; lateSubmission?: boolean; resolveHunter?: boolean; afterOpen?: (phaseId: string) => Promise<void> } = {},
): Promise<{ phaseId: string; proposal: { outcome: PhaseResolution; hunterDeadline?: string | null }; published: { outcome: PhaseResolution; winner: 'VILLAGE' | 'WEREWOLF' | null } }> {
  const phase = await game.openPhase('DAY');
  await refreshPlayers(game);
  await options.afterOpen?.(phase.phaseId);
  const living = game.living();
  const reviser = options.revise
    ? livingTarget(game, (player) => player.account.role === 'VILLAGER' && player.account.seatId !== target.account.seatId)
    : null;
  if (reviser) {
    const firstChoice = livingTarget(game, (player) => player.account.seatId !== reviser.account.seatId && player.account.seatId !== target.account.seatId, reviser);
    await reviser.prepareTarget(firstChoice.account);
    const first = await reviser.submitPrepared();
    expect(first.status).toBe(200);
    await reviser.prepareTarget(target.account);
    const revision = await reviser.submitPrepared();
    expect(revision.status).toBe(200);
    expect(revision.version).toBeGreaterThan(first.version ?? 0);
  }

  const decisions = living
    .filter((player) => player.account.seatId !== reviser?.account.seatId)
    .map((player) => ({ player, target: fallbackVoteTarget(game, player, target) }));
  await game.submitConcurrently(decisions);

  let latePlayer: BrowserPlayer | null = null;
  if (options.lateSubmission) {
    latePlayer = livingTarget(game, (player) => player.account.seatId !== target.account.seatId, reviser ?? undefined);
    const alternate = livingTarget(game, (player) => player.account.seatId !== latePlayer!.account.seatId && player.account.seatId !== target.account.seatId, latePlayer);
    await latePlayer.prepareTarget(alternate.account);
  }

  const proposal = await game.lockAndPropose(phase.phaseId);
  if (latePlayer) await latePlayer.submitPreparedExpectingError(400, /not accepting actions|closed/iu);

  expect(proposal.outcome.eliminations.map((elimination) => elimination.playerId)).toContain(target.account.seatId);
  if (options.resolveHunter && proposal.outcome.hunterRequiredIds.includes(target.account.seatId)) {
    const hunter = target;
    await hunter.reload();
    const shot = livingTarget(game, (player) => player.account.seatId !== hunter.account.seatId && !proposal.outcome.eliminations.some((elimination) => elimination.playerId === player.account.seatId), hunter);
    expect((await hunter.dashboard()).permission.actionKind).toBe('HUNTER_SHOT');
    await hunter.prepareTarget(shot.account);
    const shotResult = await hunter.submitPrepared();
    expect(shotResult.status).toBe(200);
    await game.finalizeHunter(phase.phaseId);
  }
  const published = await game.publish(phase.phaseId);
  await game.updateAlive(published.outcome);
  await refreshPlayers(game);
  return { phaseId: phase.phaseId, proposal, published };
}

export async function runNight(
  game: BrowserGame,
  options: { attackTarget?: BrowserPlayer; protectAttack?: boolean; protectTarget?: BrowserPlayer; afterOpen?: (phaseId: string) => Promise<void> } = {},
): Promise<{ phaseId: string; proposal: { outcome: PhaseResolution; hunterDeadline?: string | null }; published: { outcome: PhaseResolution; winner: 'VILLAGE' | 'WEREWOLF' | null } }> {
  const phase = await game.openPhase('NIGHT');
  await refreshPlayers(game);
  await options.afterOpen?.(phase.phaseId);
  const living = game.living();
  const wolves = living.filter((player) => player.account.role === 'WEREWOLF');
  const attackTarget = options.attackTarget ?? livingTarget(game, (player) => player.account.role !== 'WEREWOLF');
  const decisions: Array<{ player: BrowserPlayer; target: BrowserPlayer }> = wolves.map((wolf) => ({ player: wolf, target: attackTarget }));
  const bodyguard = living.find((player) => player.account.role === 'BODYGUARD');
  if (bodyguard) {
    const protectTarget = options.protectTarget
      ?? (options.protectAttack ? attackTarget : livingTarget(game, (player) => player.account.seatId !== attackTarget.account.seatId, bodyguard));
    decisions.push({ player: bodyguard, target: protectTarget });
  }
  const seer = living.find((player) => player.account.role === 'SEER');
  if (seer) {
    const investigationTarget = livingTarget(game, (player) => player.account.role === 'WEREWOLF', seer);
    decisions.push({ player: seer, target: investigationTarget });
  }
  await game.submitConcurrently(decisions);
  const proposal = await game.lockAndPropose(phase.phaseId);
  const published = await game.publish(phase.phaseId);
  await game.updateAlive(published.outcome);
  await refreshPlayers(game);
  return { phaseId: phase.phaseId, proposal, published };
}
