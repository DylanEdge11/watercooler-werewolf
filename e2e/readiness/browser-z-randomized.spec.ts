import { expect, test } from '@playwright/test';
import type { PhaseKind } from '../../lib/game/types';
import { BrowserGame, closeSharedModerator, type BrowserPlayer } from './browser-fixture';

test.describe.configure({ timeout: 1_200_000 });

class SeededRandom {
  private state: number;

  constructor(private readonly seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6D2B79F5) | 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  chance(probability: number): boolean { return this.next() < probability; }

  pick<T>(items: T[]): T {
    if (!items.length) throw new Error(`Seed ${this.seed} received an empty choice set.`);
    return items[Math.floor(this.next() * items.length)];
  }
}

async function refreshPlayers(game: BrowserGame): Promise<void> {
  // Keep the randomized stress on action writes. Serial reloads avoid turning
  // a local Next/SQLite development server restart into an artificial client
  // connection-reset failure while still converging every browser session.
  for (const player of game.players) await player.reload();
}

function choices(game: BrowserGame, actor: BrowserPlayer, predicate: (player: BrowserPlayer) => boolean): BrowserPlayer[] {
  return game.living().filter((player) => player.account.seatId !== actor.account.seatId && predicate(player));
}

async function runSeededPhase(game: BrowserGame, kind: PhaseKind, random: SeededRandom, cycle: number): Promise<{ winner: 'VILLAGE' | 'WEREWOLF' | null; hunterFollowUp: boolean }> {
  const phase = await game.openPhase(kind);
  await refreshPlayers(game);
  const living = game.living();
  const submissions: Array<Promise<void>> = [];

  if (kind === 'DAY') {
    const safeFirstCycles = cycle < 5;
    for (const actor of living) {
      if (random.chance(0.2)) continue;
      const candidates = choices(game, actor, (player) => safeFirstCycles
        ? player.account.role !== 'WEREWOLF' && player.account.role !== 'HUNTER'
        : true);
      if (!candidates.length) continue;
      const first = random.pick(candidates);
      const finalCandidates = candidates.filter((candidate) => candidate.account.seatId !== first.account.seatId);
      const final = random.chance(0.35) && finalCandidates.length ? random.pick(finalCandidates) : null;
      submissions.push((async () => {
        await actor.prepareTarget(first.account);
        expect((await actor.submitPrepared()).status).toBe(200);
        if (final) {
          await actor.prepareTarget(final.account);
          expect((await actor.submitPrepared()).status).toBe(200);
        }
      })());
    }
  } else {
    const safeFirstCycles = cycle < 5;
    for (const actor of living.filter((player) => player.account.role === 'WEREWOLF')) {
      if (random.chance(0.15)) continue;
      const candidates = choices(game, actor, (player) => safeFirstCycles
        ? player.account.role !== 'WEREWOLF' && player.account.role !== 'HUNTER'
        : player.account.role !== 'WEREWOLF');
      if (!candidates.length) continue;
      const target = random.pick(candidates);
      submissions.push((async () => {
        await actor.prepareTarget(target.account);
        expect((await actor.submitPrepared()).status).toBe(200);
      })());
    }

    const bodyguard = living.find((player) => player.account.role === 'BODYGUARD');
    if (bodyguard && !random.chance(0.2)) {
      const candidates = choices(game, bodyguard, (player) => player.account.role !== 'WEREWOLF');
      if (candidates.length) {
        const target = random.pick(candidates);
        submissions.push((async () => {
          await bodyguard.prepareTarget(target.account);
          expect((await bodyguard.submitPrepared()).status).toBe(200);
        })());
      }
    }

    const seer = living.find((player) => player.account.role === 'SEER');
    const wolves = living.filter((player) => player.account.role === 'WEREWOLF');
    if (seer && wolves.length && !random.chance(0.2)) {
      const target = random.pick(wolves);
      submissions.push((async () => {
        await seer.prepareTarget(target.account);
        expect((await seer.submitPrepared()).status).toBe(200);
      })());
    }
  }

  await Promise.all(submissions);
  const proposal = await game.lockAndPropose(phase.phaseId);
  let hunterFollowUp = false;
  if (proposal.outcome.hunterRequiredIds.length) {
    hunterFollowUp = true;
    const hunter = game.playerBySeatId(proposal.outcome.hunterRequiredIds[0]);
    await hunter.reload();
    const available = game.living().filter((player) => player.account.seatId !== hunter.account.seatId && !proposal.outcome.eliminations.some((elimination) => elimination.playerId === player.account.seatId));
    expect(available.length).toBeGreaterThan(0);
    const target = random.pick(available);
    await hunter.prepareTarget(target.account);
    expect((await hunter.submitPrepared()).status).toBe(200);
    await game.finalizeHunter(phase.phaseId);
  }
  const published = await game.publish(phase.phaseId);
  const livingBefore = new Set(living.map((player) => player.account.seatId));
  expect(published.outcome.eliminations.every((elimination) => livingBefore.has(elimination.playerId))).toBe(true);
  await game.updateAlive(published.outcome);
  await refreshPlayers(game);
  const state = await game.phases();
  const latest = state.phases.find((candidate) => candidate.id === phase.phaseId);
  expect(latest?.status).toBe('PUBLISHED');
  const statuses = await Promise.all(game.living().map(async (player) => (await player.dashboard()).game.status));
  expect(new Set(statuses).size).toBe(1);
  return { winner: published.winner, hunterFollowUp };
}

async function finishThroughFinalShowdown(game: BrowserGame, random: SeededRandom): Promise<'VILLAGE' | 'WEREWOLF'> {
  await game.enterFinalShowdown();
  for (let ballot = 0; ballot < 12; ballot += 1) {
    const phase = await game.openPhase('FINAL_BALLOT');
    await refreshPlayers(game);
    const target = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
    const decisions = game.living().map((player) => ({
      player,
      target: player.account.seatId === target.account.seatId
        ? game.chooseLiving((candidate) => candidate.account.seatId !== player.account.seatId, player)
        : target,
    }));
    if (random.chance(0.25) && decisions.length > 2) decisions.pop();
    await game.submitConcurrently(decisions);
    const proposal = await game.lockAndPropose(phase.phaseId);
    expect(proposal.outcome.hunterRequiredIds).toEqual([]);
    const published = await game.publish(phase.phaseId);
    await game.updateAlive(published.outcome);
    await refreshPlayers(game);
    if (published.winner) return published.winner;
  }
  throw new Error('The seeded browser game did not complete through Final Showdown.');
}

test.afterAll(async () => {
  await closeSharedModerator();
});

test.describe('repeatable randomized browser games', () => {
  for (const seed of [7, 21, 42]) {
    test(`runs five seeded browser Day/Night cycles (seed ${seed})`, async ({ browser }, testInfo) => {
      const random = new SeededRandom(seed);
      const game = await BrowserGame.create(browser, testInfo, { name: `Browser seeded game ${seed}` });
      testInfo.annotations.push({ type: 'seed', description: String(seed) });
      try {
        let cycles = 0;
        let winner: 'VILLAGE' | 'WEREWOLF' | null = null;
        const hunterRuns: boolean[] = [];
        for (let cycle = 0; cycle < 5 && !winner; cycle += 1) {
          const day = await runSeededPhase(game, 'DAY', random, cycle);
          hunterRuns.push(day.hunterFollowUp);
          if (day.winner) {
            winner = day.winner;
            break;
          }
          const night = await runSeededPhase(game, 'NIGHT', random, cycle);
          hunterRuns.push(night.hunterFollowUp);
          cycles += 1;
          winner = night.winner;
        }
        expect(cycles).toBeGreaterThanOrEqual(5);
        if (!winner) winner = await finishThroughFinalShowdown(game, random);
        expect(['VILLAGE', 'WEREWOLF']).toContain(winner);
        expect((await game.phases()).game.status).toBe('COMPLETED');
        await Promise.all(game.players.map(async (player) => {
          await player.expectCompleted();
          await player.expectReadOnly();
        }));
        // The boolean is deliberately retained as a test datum without
        // printing the role map or private action details.
        testInfo.annotations.push({ type: 'hunter-follow-up-observed', description: hunterRuns.some(Boolean) ? 'yes' : 'no' });
        await game.assertHealthy();
      } finally {
        await game.dispose();
      }
    });
  }
});
