import { expect, test } from '@playwright/test';
import {
  chooseLivingTarget,
  expectErrorBody,
  GameHarness,
  readError,
  type Bot,
  type Decision,
} from './bot-farm';
import { DEFAULT_COMPOSITION, E2E_PLAYER_COUNT, WEREWOLF_HEAVY_COMPOSITION } from './constants';

async function expectRejected(response: Awaited<ReturnType<Bot['context']['post']>>, status: number, message: string) {
  expect(response.status()).toBe(status);
  expectErrorBody(await readError(response), message);
}

function decision(bot: Bot, actionKind: Decision['actionKind'], ...targetIds: string[]): Decision {
  return { bot, actionKind, targetIds };
}

async function publishWithoutHunter(farm: GameHarness, phaseId: string) {
  const proposed = await farm.lockAndPropose(phaseId);
  expect(proposed.outcome.hunterRequiredIds).toEqual([]);
  const published = await farm.publish(phaseId);
  farm.updateAlive(published.outcome);
  return { proposed, published };
}

test.describe('scripted 20-player bot farm', () => {
  test('runs a complete Village win with revisions, late/dead actions, privacy, protection, and concurrent submissions', async () => {
    const farm = await GameHarness.create({ name: 'Scripted Village Win' });
    try {
      expect(farm.bots).toHaveLength(E2E_PLAYER_COUNT);
      expect(farm.byRole('WEREWOLF')).toHaveLength(DEFAULT_COMPOSITION.WEREWOLF);
      expect(farm.byRole('SEER')).toHaveLength(1);
      expect(farm.byRole('BODYGUARD')).toHaveLength(1);

      const wolves = farm.byRole('WEREWOLF');
      const seer = farm.byRole('SEER')[0];
      const bodyguard = farm.byRole('BODYGUARD')[0];
      const firstWolf = wolves[0];
      const revisionActor = farm.livingBots().find((bot) => bot.seatId !== firstWolf.seatId)!;
      const oldTarget = chooseLivingTarget(farm.livingBots(), (bot) => bot.role === 'VILLAGER', revisionActor);

      const dayOne = await farm.open('DAY');
      await farm.submitToPhase(dayOne.phaseId, decision(revisionActor, 'DAY_VOTE', oldTarget.seatId));
      await farm.submitToPhase(dayOne.phaseId, decision(revisionActor, 'DAY_VOTE', firstWolf.seatId));
      const dayOneDecisions = farm.livingBots()
        .filter((bot) => bot.seatId !== firstWolf.seatId && bot.seatId !== revisionActor.seatId)
        .map((bot) => decision(bot, 'DAY_VOTE', firstWolf.seatId));
      expect(await farm.submitConcurrently(dayOne.phaseId, dayOneDecisions)).toHaveLength(18);

      const proposalOne = await farm.lockAndPropose(dayOne.phaseId);
      expect(proposalOne.outcome.eliminations.map((item) => item.playerId)).toEqual([firstWolf.seatId]);
      expect(proposalOne.outcome.tally.find((entry) => entry.playerId === firstWolf.seatId)?.votes).toBe(19);
      expect(proposalOne.outcome.tally.some((entry) => entry.playerId === oldTarget.seatId)).toBe(false);
      expect((await farm.phases()).phases[0].currentSubmissions).toBe(19);

      const late = await revisionActor.context.post(`/api/phases/${dayOne.phaseId}/actions`, {
        data: { actionKind: 'DAY_VOTE', targetIds: [oldTarget.seatId] },
      });
      await expectRejected(late, 400, 'not accepting actions');
      const publishedOne = await farm.publish(dayOne.phaseId);
      expect(publishedOne.winner).toBeNull();
      farm.updateAlive(publishedOne.outcome);
      expect(firstWolf.alive).toBe(false);

      const nightOne = await farm.open('NIGHT');
      const protectedTarget = chooseLivingTarget(farm.livingBots(), (bot) => bot.role === 'VILLAGER', bodyguard);
      const nightOneDecisions = [
        ...farm.byRole('WEREWOLF').filter((bot) => bot.alive).map((bot) => decision(bot, 'WOLF_VOTE', protectedTarget.seatId)),
        decision(bodyguard, 'PROTECT', protectedTarget.seatId),
        decision(seer, 'INVESTIGATE', wolves.find((bot) => bot.alive)!.seatId),
      ];
      const deadAttempt = await firstWolf.context.post(`/api/phases/${nightOne.phaseId}/actions`, {
        data: { actionKind: 'WOLF_VOTE', targetIds: [protectedTarget.seatId] },
      });
      await expectRejected(deadAttempt, 400, 'Eliminated players cannot submit');
      expect(await farm.submitConcurrently(nightOne.phaseId, nightOneDecisions)).toHaveLength(nightOneDecisions.length);

      const proposalNightOne = await farm.lockAndPropose(nightOne.phaseId);
      expect(proposalNightOne.outcome.selectedTargets).toEqual([protectedTarget.seatId]);
      expect(proposalNightOne.outcome.protectedPlayerIds).toEqual([protectedTarget.seatId]);
      expect(proposalNightOne.outcome.eliminations).toEqual([]);
      expect(proposalNightOne.outcome.investigations).toEqual([
        { seerId: seer.seatId, targetId: wolves.find((bot) => bot.alive)!.seatId, role: 'WEREWOLF' },
      ]);
      const publishedNightOne = await farm.publish(nightOne.phaseId);
      farm.updateAlive(publishedNightOne.outcome);

      const seerDashboard = await farm.dashboard(seer);
      expect(seerDashboard.notifications.some((notification) => notification.body.includes('is the WEREWOLF'))).toBe(true);
      const ordinaryVillager = chooseLivingTarget(farm.livingBots(), (bot) => bot.role === 'VILLAGER');
      const villagerDashboard = await farm.dashboard(ordinaryVillager);
      const nightTimeline = villagerDashboard.timeline.find((event) => event.payload.kind === 'NIGHT');
      expect(nightTimeline).toBeDefined();
      expect(nightTimeline?.payload).not.toHaveProperty('investigations');
      expect(nightTimeline?.payload).not.toHaveProperty('protectedPlayerIds');
      expect(nightTimeline?.payload).not.toHaveProperty('proposedOutcome');
      expect(villagerDashboard.notifications.some((notification) => notification.body.includes('is the WEREWOLF'))).toBe(false);
      expect(villagerDashboard.candidates.every((candidate) => !Object.hasOwn(candidate, 'role'))).toBe(true);

      const privatePhases = await ordinaryVillager.context.get(`/api/games/${farm.gameId}/phases`);
      await expectRejected(privatePhases, 401, 'Moderator authentication required');
      const privateAssignments = await ordinaryVillager.context.get(`/api/games/${farm.gameId}/assignments`);
      await expectRejected(privateAssignments, 401, 'Moderator authentication required');
      const forgedPlayerQuery = await ordinaryVillager.context.get(`/api/player?seatId=${encodeURIComponent(seer.seatId)}`);
      expect(forgedPlayerQuery.status()).toBe(200);
      const forgedPlayerData = await forgedPlayerQuery.json() as { player: { id: string; role: string } };
      expect(forgedPlayerData.player.id).toBe(ordinaryVillager.seatId);
      expect(forgedPlayerData.player.role).toBe('VILLAGER');

      const secondWolf = wolves.find((bot) => bot.alive)!;
      const dayTwo = await farm.open('DAY');
      const dayTwoDecisions = farm.livingBots()
        .filter((bot) => bot.seatId !== secondWolf.seatId)
        .map((bot) => decision(bot, 'DAY_VOTE', secondWolf.seatId));
      expect(await farm.submitConcurrently(dayTwo.phaseId, dayTwoDecisions)).toHaveLength(farm.livingBots().length - 1);
      const proposalTwo = await farm.lockAndPropose(dayTwo.phaseId);
      expect(proposalTwo.outcome.eliminations.map((item) => item.playerId)).toEqual([secondWolf.seatId]);
      const publishedTwo = await farm.publish(dayTwo.phaseId);
      farm.updateAlive(publishedTwo.outcome);

      const thirdWolf = wolves.find((bot) => bot.alive)!;
      const nightTwo = await farm.open('NIGHT');
      const nightTargetTwo = chooseLivingTarget(farm.livingBots(), (bot) => bot.role === 'VILLAGER', bodyguard);
      const guardTargetTwo = chooseLivingTarget(
        farm.livingBots(),
        (bot) => bot.role === 'VILLAGER' && bot.seatId !== nightTargetTwo.seatId,
        bodyguard,
      );
      await farm.submitConcurrently(nightTwo.phaseId, [
        decision(thirdWolf, 'WOLF_VOTE', nightTargetTwo.seatId),
        decision(bodyguard, 'PROTECT', guardTargetTwo.seatId),
        decision(seer, 'INVESTIGATE', thirdWolf.seatId),
      ]);
      const { published: publishedNightTwo } = await publishWithoutHunter(farm, nightTwo.phaseId);
      expect(publishedNightTwo.winner).toBeNull();

      const dayThree = await farm.open('DAY');
      const dayThreeDecisions = farm.livingBots()
        .filter((bot) => bot.seatId !== thirdWolf.seatId)
        .map((bot) => decision(bot, 'DAY_VOTE', thirdWolf.seatId));
      await farm.submitConcurrently(dayThree.phaseId, dayThreeDecisions);
      const { published: publishedThree } = await publishWithoutHunter(farm, dayThree.phaseId);
      expect(publishedThree.winner).toBe('VILLAGE');
      expect(farm.expectedWinner()).toBe('VILLAGE');
      expect((await farm.phases()).game.status).toBe('COMPLETED');
    } finally {
      await farm.dispose();
    }
  });

  test('runs a complete Werewolf win by reaching parity after a Day and Night', async () => {
    const farm = await GameHarness.create({ name: 'Scripted Werewolf Win', composition: WEREWOLF_HEAVY_COMPOSITION });
    try {
      const wolves = farm.byRole('WEREWOLF');
      const seer = farm.byRole('SEER')[0];
      const bodyguard = farm.byRole('BODYGUARD')[0];
      const firstVillage = farm.byRole('VILLAGER')[0];
      const day = await farm.open('DAY');
      const dayDecisions = farm.livingBots()
        .filter((bot) => bot.seatId !== firstVillage.seatId)
        .map((bot) => decision(bot, 'DAY_VOTE', firstVillage.seatId));
      expect(await farm.submitConcurrently(day.phaseId, dayDecisions)).toHaveLength(19);
      const dayProposal = await farm.lockAndPropose(day.phaseId);
      expect(dayProposal.outcome.eliminations.map((item) => item.playerId)).toEqual([firstVillage.seatId]);
      const dayPublished = await farm.publish(day.phaseId);
      expect(dayPublished.winner).toBeNull();
      farm.updateAlive(dayPublished.outcome);
      expect(farm.expectedWinner()).toBeNull();

      const secondVillage = chooseLivingTarget(farm.livingBots(), (bot) => bot.role === 'VILLAGER');
      const night = await farm.open('NIGHT');
      const guardDiversion = chooseLivingTarget(
        farm.livingBots(),
        (bot) => bot.role !== 'WEREWOLF' && bot.seatId !== secondVillage.seatId,
        bodyguard,
      );
      const nightDecisions = [
        ...wolves.filter((bot) => bot.alive).map((bot) => decision(bot, 'WOLF_VOTE', secondVillage.seatId)),
        decision(bodyguard, 'PROTECT', guardDiversion.seatId),
        decision(seer, 'INVESTIGATE', wolves[0].seatId),
      ];
      expect(await farm.submitConcurrently(night.phaseId, nightDecisions)).toHaveLength(nightDecisions.length);
      const nightProposal = await farm.lockAndPropose(night.phaseId);
      expect(nightProposal.outcome.selectedTargets).toEqual([secondVillage.seatId]);
      expect(nightProposal.outcome.protectedPlayerIds).toEqual([guardDiversion.seatId]);
      expect(nightProposal.outcome.eliminations.map((item) => item.playerId)).toEqual([secondVillage.seatId]);
      const nightPublished = await farm.publish(night.phaseId);
      farm.updateAlive(nightPublished.outcome);
      expect(nightPublished.winner).toBe('WEREWOLF');
      expect(farm.expectedWinner()).toBe('WEREWOLF');
      expect((await farm.phases()).game.status).toBe('COMPLETED');

      const playerAfterCompletion = await farm.dashboard(wolves[0]);
      expect(playerAfterCompletion.game.status).toBe('COMPLETED');
      expect(playerAfterCompletion.timeline.some((event) => event.eventType === 'GAME_COMPLETED' && event.payload.winner === 'WEREWOLF')).toBe(true);
      expect(playerAfterCompletion.rooms.every((room) => room.status === 'READ_ONLY')).toBe(true);
    } finally {
      await farm.dispose();
    }
  });

  test('checks missing votes, boundary ties, dead-player rejection, and protected attacks', async () => {
    const farm = await GameHarness.create({ name: 'Scripted Edge Rules' });
    try {
      const candidateOne = farm.byRole('VILLAGER')[0];
      const candidateTwo = farm.byRole('VILLAGER')[1];
      const voterOne = farm.livingBots().find((bot) => bot.seatId !== candidateOne.seatId && bot.seatId !== candidateTwo.seatId)!;
      const voterTwo = farm.livingBots().find((bot) => bot.seatId !== voterOne.seatId && bot.seatId !== candidateOne.seatId && bot.seatId !== candidateTwo.seatId)!;

      const day = await farm.open('DAY');
      expect(await farm.submitConcurrently(day.phaseId, [
        decision(voterOne, 'DAY_VOTE', candidateOne.seatId),
        decision(voterTwo, 'DAY_VOTE', candidateTwo.seatId),
      ])).toHaveLength(2);
      const proposal = await farm.lockAndPropose(day.phaseId);
      expect(proposal.outcome.tally).toEqual(expect.arrayContaining([
        { playerId: candidateOne.seatId, votes: 1 },
        { playerId: candidateTwo.seatId, votes: 1 },
      ]));
      expect(proposal.outcome.randomDraws).toHaveLength(1);
      expect(proposal.outcome.randomDraws[0].candidates.sort()).toEqual([candidateOne.seatId, candidateTwo.seatId].sort());
      expect(proposal.outcome.eliminations).toHaveLength(1);
      expect((await farm.phases()).phases[0].currentSubmissions).toBe(2);
      const published = await farm.publish(day.phaseId);
      farm.updateAlive(published.outcome);
      const eliminated = farm.botBySeatId(published.outcome.eliminations[0].playerId);
      expect([candidateOne.seatId, candidateTwo.seatId]).toContain(eliminated.seatId);

      const night = await farm.open('NIGHT');
      const target = chooseLivingTarget(farm.livingBots(), (bot) => bot.role === 'VILLAGER', farm.byRole('BODYGUARD')[0]);
      const deadAttempt = await eliminated.context.post(`/api/phases/${night.phaseId}/actions`, {
        data: { actionKind: 'DAY_VOTE', targetIds: [target.seatId] },
      });
      await expectRejected(deadAttempt, 400, 'Eliminated players cannot submit');

      const wolves = farm.byRole('WEREWOLF').filter((bot) => bot.alive);
      const bodyguard = farm.byRole('BODYGUARD')[0];
      const seer = farm.byRole('SEER')[0];
      const decisions = [
        ...wolves.map((bot) => decision(bot, 'WOLF_VOTE', target.seatId)),
        decision(bodyguard, 'PROTECT', target.seatId),
        decision(seer, 'INVESTIGATE', wolves[0].seatId),
      ];
      expect(await farm.submitConcurrently(night.phaseId, decisions)).toHaveLength(decisions.length);
      const protectedProposal = await farm.lockAndPropose(night.phaseId);
      expect(protectedProposal.outcome.protectedPlayerIds).toEqual([target.seatId]);
      expect(protectedProposal.outcome.eliminations).toEqual([]);
      const protectedPublish = await farm.publish(night.phaseId);
      farm.updateAlive(protectedPublish.outcome);
      expect(protectedPublish.winner).toBeNull();
      expect(target.alive).toBe(true);
    } finally {
      await farm.dispose();
    }
  });
});
