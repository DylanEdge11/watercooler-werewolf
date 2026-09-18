import { expect, test } from '@playwright/test';
import { GameHarness, type Bot, type Decision } from './bot-farm';

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6D2B79F5) | 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: T[]): T {
    if (!items.length) throw new Error('The seeded randomizer received an empty choice set.');
    return items[Math.floor(this.next() * items.length)];
  }
}

function targetChoices(bots: Bot[], actor: Bot, predicate: (bot: Bot) => boolean): Bot[] {
  return bots.filter((bot) => bot.alive && bot.seatId !== actor.seatId && predicate(bot));
}

async function runRandomPhase(farm: GameHarness, kind: 'DAY' | 'NIGHT', random: SeededRandom) {
  const phase = await farm.open(kind);
  const living = farm.livingBots();
  const submissions: Array<Promise<unknown>> = [];
  const expectedActors = new Set<string>();
  let submissionCount = 0;

  if (kind === 'DAY') {
    for (const bot of living) {
      if (random.chance(0.22)) continue;
      const choices = targetChoices(living, bot, () => true);
      if (!choices.length) continue;
      const first = random.pick(choices);
      const revise = random.chance(0.32);
      const final = revise ? random.pick(choices.filter((candidate) => candidate.seatId !== first.seatId) || choices) : null;
      expectedActors.add(bot.seatId);
      submissions.push((async () => {
        await farm.submitToPhase(phase.phaseId, { bot, actionKind: 'DAY_VOTE', targetIds: [first.seatId] });
        submissionCount += 1;
        if (final) {
          await farm.submitToPhase(phase.phaseId, { bot, actionKind: 'DAY_VOTE', targetIds: [final.seatId] });
          submissionCount += 1;
        }
      })());
    }
  } else {
    for (const bot of living.filter((candidate) => candidate.role === 'WEREWOLF')) {
      if (random.chance(0.12)) continue;
      const choices = targetChoices(living, bot, (candidate) => candidate.role !== 'WEREWOLF');
      if (!choices.length) continue;
      const target = random.pick(choices);
      expectedActors.add(bot.seatId);
      submissions.push(farm.submitToPhase(phase.phaseId, { bot, actionKind: 'WOLF_VOTE', targetIds: [target.seatId] }));
      submissionCount += 1;
    }

    const bodyguard = living.find((bot) => bot.role === 'BODYGUARD');
    if (bodyguard && random.chance(0.9)) {
      const choices = targetChoices(living, bodyguard, () => true);
      if (choices.length) {
        expectedActors.add(bodyguard.seatId);
        submissions.push(farm.submitToPhase(phase.phaseId, { bot: bodyguard, actionKind: 'PROTECT', targetIds: [random.pick(choices).seatId] }));
        submissionCount += 1;
      }
    }

    const seer = living.find((bot) => bot.role === 'SEER');
    if (seer && random.chance(0.9)) {
      const choices = targetChoices(living, seer, () => true);
      if (choices.length) {
        expectedActors.add(seer.seatId);
        submissions.push(farm.submitToPhase(phase.phaseId, { bot: seer, actionKind: 'INVESTIGATE', targetIds: [random.pick(choices).seatId] }));
        submissionCount += 1;
      }
    }
  }

  await Promise.all(submissions);
  expect(submissionCount).toBeGreaterThanOrEqual(expectedActors.size);
  const phaseAfterActions = (await farm.phases()).phases.find((entry) => entry.id === phase.phaseId);
  expect(phaseAfterActions?.currentSubmissions).toBe(expectedActors.size);

  let proposal = await farm.lockAndPropose(phase.phaseId);
  if (proposal.outcome.hunterRequiredIds.length > 0) {
    const hunter = farm.botBySeatId(proposal.outcome.hunterRequiredIds[0]);
    const excluded = new Set(proposal.outcome.eliminations.map((item) => item.playerId));
    const choices = farm.livingBots().filter((bot) => bot.seatId !== hunter.seatId && !excluded.has(bot.seatId));
    expect(choices.length).toBeGreaterThan(0);
    const hunterTarget = random.pick(choices);
    await farm.submitToPhase(phase.phaseId, { bot: hunter, actionKind: 'HUNTER_SHOT', targetIds: [hunterTarget.seatId] });
    proposal = await farm.finalizeHunter(phase.phaseId);
  }

  const beforePublication = farm.livingBots().map((bot) => bot.seatId);
  const published = await farm.publish(phase.phaseId);
  farm.updateAlive(published.outcome);
  const eliminatedBeforePublication = new Set(beforePublication);
  expect(published.outcome.eliminations.every((item) => eliminatedBeforePublication.has(item.playerId))).toBe(true);
  expect(published.winner).toBe(farm.expectedWinner());
  const phaseState = (await farm.phases()).phases.find((entry) => entry.id === phase.phaseId);
  expect(phaseState?.status).toBe('PUBLISHED');
  return { phase, proposal, published };
}

async function runSeededGame(seed: number): Promise<void> {
  const farm = await GameHarness.create({ name: `Seeded Random Game ${seed}` });
  const random = new SeededRandom(seed);
  try {
    let kind: 'DAY' | 'NIGHT' = 'DAY';
    let completed = false;
    for (let round = 0; round < 10; round += 1) {
      const result = await runRandomPhase(farm, kind, random);
      if (result.published.winner) {
        completed = true;
        break;
      }
      kind = kind === 'DAY' ? 'NIGHT' : 'DAY';
    }

    if (!completed) {
      await farm.enterFinalShowdown();
      for (let ballot = 0; ballot < 8; ballot += 1) {
        const finalPhase = await farm.open('FINAL_BALLOT');
        const target = farm.byRole('WEREWOLF').find((bot) => bot.alive);
        expect(target).toBeDefined();
        if (!target) throw new Error('The final ballot started without a living Werewolf.');
        const decisions: Decision[] = farm.livingBots()
          .filter((bot) => bot.seatId !== target.seatId)
          .map((bot) => ({ bot, actionKind: 'DAY_VOTE', targetIds: [target.seatId] }));
        await farm.submitConcurrently(finalPhase.phaseId, decisions);
        const proposed = await farm.lockAndPropose(finalPhase.phaseId);
        expect(proposed.outcome.hunterRequiredIds).toEqual([]);
        const published = await farm.publish(finalPhase.phaseId);
        farm.updateAlive(published.outcome);
        expect(published.winner).toBe(farm.expectedWinner());
        if (published.winner) {
          completed = true;
          break;
        }
      }
    }

    expect(completed, `seed ${seed} did not reach a terminal result`).toBe(true);
    expect((await farm.phases()).game.status).toBe('COMPLETED');
  } finally {
    await farm.dispose();
  }
}

test.describe('repeatable seeded random 20-player games', () => {
  for (const seed of [7, 21, 42]) {
    test(`explores a seeded decision stream (seed ${seed})`, async () => {
      await runSeededGame(seed);
    });
  }
});
