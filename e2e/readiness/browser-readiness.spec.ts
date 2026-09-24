import { expect, test } from '@playwright/test';
import type { ActionKind, PhaseResolution } from '../../lib/game/types';
import { BASE_URL, DEFAULT_COMPOSITION, E2E_PLAYER_COUNT } from '../constants';
import { newBrowserContext } from '../transport';
import {
  BrowserGame,
  closeSharedModerator,
  type ModeratorPhasesResponse,
  verifyExpectedRoleComposition,
} from './browser-fixture';
import { fallbackVoteTarget, livingTarget, refreshPlayers, runDayElimination, runNight } from './game-steps';

test.describe.configure({ timeout: 900_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

function currentPhase(state: ModeratorPhasesResponse): ModeratorPhasesResponse['phases'][number] {
  const phase = state.phases.find((candidate) => !['PUBLISHED', 'SUPERSEDED'].includes(candidate.status));
  if (!phase) throw new Error('No current moderator phase was available.');
  return phase;
}

test.describe('browser player-readiness scenarios', () => {
  test('twenty independent players complete onboarding and privacy checks', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { setupThroughUi: true, mobilePlayerIndex: 0 });
    try {
      verifyExpectedRoleComposition(game.accounts, DEFAULT_COMPOSITION);
      expect(new Set(game.players.map((player) => player.context)).size).toBe(E2E_PLAYER_COUNT);
      expect(new Set(game.players.map((player) => player.page)).size).toBe(E2E_PLAYER_COUNT);
      expect(new Set(game.accounts.map((player) => player.seatId)).size).toBe(E2E_PLAYER_COUNT);

      for (const player of game.players) {
        const dashboard = await game.assertPlayerPrivacy(player);
        const expectedTeammates = ['WEREWOLF', 'MASON'].includes(player.account.role)
          ? game.players.filter((candidate) => candidate.account.role === player.account.role && candidate.account.seatId !== player.account.seatId).map((candidate) => candidate.account.seatId).sort()
          : [];
        expect(dashboard.player.teammates.map((teammate) => teammate.id).sort()).toEqual(expectedTeammates);
        await game.assertModeratorOnlyRoutes(player);
      }

      const first = game.players[0];
      const other = game.players[1];
      await first.page.goto(`${BASE_URL}/?seatId=${encodeURIComponent(other.account.seatId)}`);
      await first.waitForDashboard();
      const forgedDashboard = await first.dashboard();
      expect(forgedDashboard.player.id).toBe(first.account.seatId);
      expect(forgedDashboard.player.role).toBe(first.account.role);

      const duplicateClaimContext = await newBrowserContext(browser);
      const duplicateClaimPage = await duplicateClaimContext.newPage();
      game.telemetry.attach(duplicateClaimPage, 'duplicate-claim');
      try {
        await duplicateClaimPage.goto(other.account.claimUrl);
        await expect(duplicateClaimPage.getByRole('button', { name: 'Claim my seat', exact: true })).toBeVisible();
        await duplicateClaimPage.getByLabel('Six-digit PIN').fill('499999');
        const claimResponsePromise = duplicateClaimPage.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/seats\/claim\/[^/]+$/u.test(new URL(response.url()).pathname));
        game.telemetry.allowConsoleError(/status of 409/iu);
        await duplicateClaimPage.getByRole('button', { name: 'Claim my seat', exact: true }).click();
        const claimResponse = await claimResponsePromise;
        expect(claimResponse.status()).toBe(409);
        game.telemetry.allowResponse(claimResponse);
        await expect(duplicateClaimPage.getByText(/already claimed|sign-in/iu).first()).toBeVisible();
      } finally {
        await duplicateClaimContext.close();
      }

      const phase = await game.openPhase('DAY');
      await Promise.all(game.players.map(async (player) => {
        const dashboard = await player.reload();
        expect(dashboard.phase?.id).toBe(phase.phaseId);
        expect(dashboard.permission.actionKind).toBe('DAY_VOTE');
        expect(dashboard.candidates).toHaveLength(E2E_PLAYER_COUNT - 1);
        expect(dashboard.candidates.every((candidate) => Object.keys(candidate).sort().join(',') === 'displayName,id')).toBe(true);
        await game.assertPlayerPrivacy(player);
      }));
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('scripted standard-composition Village win uses browser actions and read-only completion', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser scripted Village win' });
    try {
      const wolfOne = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
      const firstDay = await runDayElimination(game, wolfOne, { revise: true, lateSubmission: true });
      expect(firstDay.published.winner).toBeNull();

      const protectedTarget = livingTarget(game, (player) => player.account.role === 'VILLAGER');
      const firstNight = await runNight(game, { attackTarget: protectedTarget, protectAttack: true });
      expect(firstNight.proposal.outcome.protectedPlayerIds).toContain(protectedTarget.account.seatId);
      expect(firstNight.proposal.outcome.eliminations).toEqual([]);
      expect(protectedTarget.account.alive).toBe(true);

      const seer = game.byRole('SEER')[0];
      const ordinary = game.chooseLiving((player) => player.account.role === 'VILLAGER');
      await expect(seer.page.getByRole('heading', { name: 'Private result history', exact: true })).toBeVisible();
      await expect(seer.page.getByText(/is the werewolf\./iu)).toBeVisible();
      await expect(ordinary.page.getByText(/is the werewolf\./iu)).toHaveCount(0);
      // This assertion intentionally covers the complete HTTP response. The
      // reviewed application currently fails it because the public timeline
      // contains the full Night proposal.
      await game.assertPlayerPrivacy(ordinary);
      await game.assertPlayerPrivacy(seer, { allowOwnInvestigation: true });

      const wolfTwo = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
      const secondDay = await runDayElimination(game, wolfTwo, { lateSubmission: true });
      expect(secondDay.published.winner).toBeNull();
      const secondNightTarget = livingTarget(game, (player) => player.account.role === 'VILLAGER');
      const secondNight = await runNight(game, { attackTarget: secondNightTarget, protectAttack: true });
      expect(secondNight.published.winner).toBeNull();

      const wolfThree = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
      const finalDay = await runDayElimination(game, wolfThree);
      expect(finalDay.published.winner).toBe('VILLAGE');
      expect((await game.phases()).game.status).toBe('COMPLETED');

      await Promise.all(game.players.map(async (player) => {
        await player.expectCompleted();
        await player.expectReadOnly();
      }));
      const livingPlayer = game.living()[0];
      await game.assertNoActionAfterCompletion(livingPlayer, finalDay.phaseId, game.chooseLiving((player) => player.account.seatId !== livingPlayer.account.seatId, livingPlayer));
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('scripted standard-composition Werewolf win reaches the actual parity rule', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser scripted Werewolf win' });
    try {
      let terminal: 'VILLAGE' | 'WEREWOLF' | null = null;
      for (let cycle = 0; cycle < 7 && !terminal; cycle += 1) {
        const dayTarget = livingTarget(game, (player) => player.account.role !== 'WEREWOLF' && player.account.role !== 'HUNTER');
        const day = await runDayElimination(game, dayTarget);
        expect(day.published.winner).toBeNull();
        const nightTarget = livingTarget(game, (player) => player.account.role !== 'WEREWOLF' && player.account.role !== 'HUNTER');
        const night = await runNight(game, { attackTarget: nightTarget, protectAttack: false });
        terminal = night.published.winner;
        if (cycle < 6) expect(terminal).toBeNull();
      }
      expect(terminal).toBe('WEREWOLF');
      const state = await game.phases();
      expect(state.game.status).toBe('COMPLETED');
      const livingWolves = game.living().filter((player) => player.account.role === 'WEREWOLF').length;
      const livingVillage = game.living().length - livingWolves;
      expect(livingWolves).toBeGreaterThanOrEqual(livingVillage);
      await Promise.all(game.players.map(async (player) => {
        await player.expectCompleted();
        await player.expectReadOnly();
      }));
      await expect(game.moderator.page.getByRole('button', { name: 'Open phase', exact: true })).toHaveCount(0);
      await game.assertNoActionAfterCompletion(game.living()[0], state.phases[0].id, game.chooseLiving((player) => player.account.seatId !== game.living()[0].account.seatId, game.living()[0]));
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('eliminated players are read-only and cannot submit any action kind', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser eliminated-player behavior' });
    try {
      const villager = game.byRole('VILLAGER')[0];
      await runDayElimination(game, villager);
      const seer = game.byRole('SEER')[0];
      await runNight(game, { attackTarget: seer, protectAttack: false });
      const wolf = game.byRole('WEREWOLF')[0];
      await runDayElimination(game, wolf);
      const bodyguard = game.byRole('BODYGUARD')[0];
      await runNight(game, { attackTarget: bodyguard, protectAttack: false });
      const hunter = game.byRole('HUNTER')[0];
      const hunterDay = await runDayElimination(game, hunter, { resolveHunter: true });
      expect(hunter.account.alive).toBe(false);
      const nextNight = await game.openPhase('NIGHT');
      const baseline = currentPhase(await game.phases()).currentSubmissions;
      const victims = [villager, seer, wolf, bodyguard, hunter];
      const actionKinds: ActionKind[] = ['DAY_VOTE', 'WOLF_VOTE', 'PROTECT', 'INVESTIGATE', 'HUNTER_SHOT'];
      const target = game.living()[0];
      for (const victim of victims) {
        await victim.reload();
        const eliminatedMessage = victim.page.getByText('You have been eliminated.', { exact: false });
        await expect(eliminatedMessage).toBeVisible();
        await expect(eliminatedMessage.locator('..').locator('..').getByText('Eliminated', { exact: true })).toBeVisible();
        for (const actionKind of actionKinds) {
          const result = await victim.submitActionDirect(nextNight.phaseId, actionKind, [target.account.seatId]);
          expect(result.response.status()).toBe(400);
          expect(`${result.body.error ?? ''} ${(result.body.errors ?? []).join(' ')}`).toMatch(/eliminated|available|action/iu);
        }
      }
      expect(currentPhase(await game.phases()).currentSubmissions).toBe(baseline);
      expect(hunterDay.published.outcome.eliminations.filter((elimination) => elimination.playerId === hunter.account.seatId)).toHaveLength(1);
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('duplicate revisions, double clicks, closed phases, and concurrent races remain consistent', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser duplicate and closed phase checks' });
    try {
      const phase = await game.openPhase('DAY');
      await refreshPlayers(game);
      const voter = game.players[0];
      const firstTarget = game.chooseLiving((player) => player.account.seatId !== voter.account.seatId, voter);
      const secondTarget = game.chooseLiving((player) => player.account.seatId !== voter.account.seatId && player.account.seatId !== firstTarget.account.seatId, voter);
      await voter.prepareTarget(firstTarget.account);
      const first = await voter.submitPrepared();
      await voter.prepareTarget(secondTarget.account);
      const second = await voter.submitPrepared();
      expect(second.version).toBeGreaterThan(first.version ?? 0);
      expect((await voter.dashboard()).currentAction?.targetIds).toEqual([secondTarget.account.seatId]);

      const doubleClickPlayer = game.players[1];
      const doubleTarget = game.chooseLiving((player) => player.account.seatId !== doubleClickPlayer.account.seatId, doubleClickPlayer);
      await doubleClickPlayer.prepareTarget(doubleTarget.account);
      expect(await doubleClickPlayer.doubleClickPrepared()).toBe(1);
      expect((await doubleClickPlayer.dashboard()).currentAction?.version).toBe(1);

      const racePlayer = game.players[2];
      const raceA = game.chooseLiving((player) => player.account.seatId !== racePlayer.account.seatId, racePlayer);
      const raceB = game.chooseLiving((player) => player.account.seatId !== racePlayer.account.seatId && player.account.seatId !== raceA.account.seatId, racePlayer);
      const raceResponses = await Promise.all([
        racePlayer.submitActionDirect(phase.phaseId, 'DAY_VOTE', [raceA.account.seatId]),
        racePlayer.submitActionDirect(phase.phaseId, 'DAY_VOTE', [raceB.account.seatId]),
      ]);
      expect(raceResponses.every((result) => result.response.status() < 500)).toBe(true);
      const latestRaceAction = (await racePlayer.dashboard()).currentAction;
      expect(latestRaceAction?.version).toBeGreaterThanOrEqual(1);
      expect([raceA.account.seatId, raceB.account.seatId]).toContain(latestRaceAction?.targetIds[0]);

      const beforeLock = game.players[3];
      const beforeLockTarget = game.chooseLiving((player) => player.account.seatId !== beforeLock.account.seatId, beforeLock);
      await beforeLock.prepareTarget(beforeLockTarget.account);
      const lockRace = await Promise.all([
        beforeLock.submitPrepared(),
        game.lockAndPropose(phase.phaseId),
      ]);
      expect(lockRace[0].status).toBeLessThan(500);
      const proposal = lockRace[1] as { outcome: PhaseResolution };
      expect(proposal.outcome.eliminations.length).toBeLessThanOrEqual(1);

      const afterLock = game.players[4];
      await afterLock.reload();
      expect((await afterLock.dashboard()).permission.actionKind).toBeNull();
      const afterLockTarget = game.chooseLiving((player) => player.account.seatId !== afterLock.account.seatId, afterLock);
      const late = await afterLock.submitActionDirect(phase.phaseId, 'DAY_VOTE', [afterLockTarget.account.seatId]);
      expect(late.response.status()).toBe(400);
      expect(`${late.body.error ?? ''} ${(late.body.errors ?? []).join(' ')}`).toMatch(/not accepting|closed/iu);
      await game.publish(phase.phaseId);
      const afterPublication = await game.players[5].submitActionDirect(phase.phaseId, 'DAY_VOTE', [game.players[6].account.seatId]);
      expect(afterPublication.response.status()).toBe(400);
      expect((await game.phases()).phases.find((candidate) => candidate.id === phase.phaseId)?.status).toBe('PUBLISHED');
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('ties, missing votes, protection, and Hunter follow-up obey the recorded rules', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser ties protection and Hunter' });
    try {
      const tiePhase = await game.openPhase('DAY');
      await refreshPlayers(game);
      const candidateA = game.byRole('VILLAGER')[0];
      const candidateB = game.byRole('VILLAGER')[1];
      const voterA = game.chooseLiving((player) => player.account.seatId !== candidateA.account.seatId && player.account.seatId !== candidateB.account.seatId);
      const voterB = game.chooseLiving((player) => player.account.seatId !== voterA.account.seatId && player.account.seatId !== candidateA.account.seatId && player.account.seatId !== candidateB.account.seatId);
      await voterA.prepareTarget(candidateA.account);
      await voterB.prepareTarget(candidateB.account);
      await Promise.all([voterA.submitPrepared(), voterB.submitPrepared()]);
      const tieProposal = await game.lockAndPropose(tiePhase.phaseId);
      expect(tieProposal.outcome.randomDraws).toHaveLength(1);
      expect(tieProposal.outcome.randomDraws[0].candidates.sort()).toEqual([candidateA.account.seatId, candidateB.account.seatId].sort());
      expect([candidateA.account.seatId, candidateB.account.seatId]).toContain(tieProposal.outcome.eliminations[0]?.playerId);
      await expect(game.moderator.page.getByText('A recorded random draw resolved a boundary tie.', { exact: true })).toBeVisible();
      const tiePublished = await game.publish(tiePhase.phaseId);
      await game.updateAlive(tiePublished.outcome);
      await refreshPlayers(game);

      const noVotePhase = await game.openPhase('NIGHT');
      const noVoteProposal = await game.lockAndPropose(noVotePhase.phaseId);
      expect(noVoteProposal.outcome.eliminations).toEqual([]);
      expect(noVoteProposal.outcome.tally).toEqual([]);
      const noVotePublished = await game.publish(noVotePhase.phaseId);
      expect(noVotePublished.outcome.eliminations).toEqual([]);
      await refreshPlayers(game);

      const partialTarget = game.chooseLiving((player) => player.account.role === 'VILLAGER');
      const partialPhase = await game.openPhase('DAY');
      const partialVoter = game.chooseLiving((player) => player.account.seatId !== partialTarget.account.seatId);
      await partialVoter.prepareTarget(partialTarget.account);
      await partialVoter.submitPrepared();
      const partialProposal = await game.lockAndPropose(partialPhase.phaseId);
      expect(partialProposal.outcome.eliminations.map((elimination) => elimination.playerId)).toEqual([partialTarget.account.seatId]);
      const partialPublished = await game.publish(partialPhase.phaseId);
      await game.updateAlive(partialPublished.outcome);
      await refreshPlayers(game);

      const attackTarget = game.chooseLiving((player) => player.account.role === 'VILLAGER');
      const protectedNight = await game.openPhase('NIGHT');
      await refreshPlayers(game);
      const wolves = game.living().filter((player) => player.account.role === 'WEREWOLF');
      const guard = game.byRole('BODYGUARD')[0];
      const seer = game.byRole('SEER')[0];
      const invalidSelf = await guard.submitActionDirect(protectedNight.phaseId, 'PROTECT', [guard.account.seatId]);
      expect(invalidSelf.response.status()).toBe(400);
      expect(`${invalidSelf.body.error ?? ''} ${(invalidSelf.body.errors ?? []).join(' ')}`).toContain('yourself');
      const protectionDecisions = wolves.map((wolf) => ({ player: wolf, target: attackTarget }));
      protectionDecisions.push({ player: guard, target: game.chooseLiving((player) => player.account.seatId !== attackTarget.account.seatId, guard) });
      protectionDecisions.push({ player: seer, target: wolves[0] });
      await game.submitConcurrently(protectionDecisions);
      await guard.prepareTarget(attackTarget.account);
      await guard.submitPrepared();
      const protectedProposal = await game.lockAndPropose(protectedNight.phaseId);
      expect(protectedProposal.outcome.protectedPlayerIds).toEqual([attackTarget.account.seatId]);
      expect(protectedProposal.outcome.eliminations).toEqual([]);
      await game.publish(protectedNight.phaseId);
      await refreshPlayers(game);

      const hunter = game.byRole('HUNTER')[0];
      const hunterDay = await game.openPhase('DAY');
      await refreshPlayers(game);
      const hunterVoters = game.living().map((player) => ({ player, target: fallbackVoteTarget(game, player, hunter) }));
      await game.submitConcurrently(hunterVoters);
      const hunterProposal = await game.lockAndPropose(hunterDay.phaseId);
      expect(hunterProposal.outcome.hunterRequiredIds).toContain(hunter.account.seatId);
      await hunter.reload();
      expect((await hunter.dashboard()).permission.actionKind).toBe('HUNTER_SHOT');
      const ordinary = game.chooseLiving((player) => player.account.seatId !== hunter.account.seatId, hunter);
      const unauthorizedShot = await ordinary.submitActionDirect(hunterDay.phaseId, 'HUNTER_SHOT', [attackTarget.account.seatId]);
      expect(unauthorizedShot.response.status()).toBe(400);
      await expect(game.moderator.page.getByRole('button', { name: 'Approve & publish', exact: true })).toHaveCount(0);
      await hunter.reload();
      const shotTarget = attackTarget.account.alive ? attackTarget : game.chooseLiving((player) => player.account.seatId !== hunter.account.seatId, hunter);
      await hunter.prepareTarget(shotTarget.account);
      expect((await hunter.submitPrepared()).status).toBe(200);
      expect((await hunter.reload()).currentAction?.targetIds).toEqual([shotTarget.account.seatId]);
      await game.finalizeHunter(hunterDay.phaseId);
      const hunterPublished = await game.publish(hunterDay.phaseId);
      expect(hunterPublished.outcome.eliminations.filter((elimination) => elimination.playerId === hunter.account.seatId)).toHaveLength(1);
      expect(hunterPublished.outcome.eliminations.filter((elimination) => elimination.playerId === shotTarget.account.seatId)).toHaveLength(1);
      await game.updateAlive(hunterPublished.outcome);
      await refreshPlayers(game);
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('reload, mobile layout, keyboard action, loading guards, and phase transitions remain usable', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser resilience and UI readiness', mobilePlayerIndex: 0 });
    try {
      const mobile = game.players[0];
      await mobile.reload();
      await expect(mobile.page.getByRole('heading', { name: 'The village is voting.', exact: true })).toHaveCount(0);
      const phase = await game.openPhase('DAY');
      await mobile.reload();
      expect((await mobile.dashboard()).phase?.id).toBe(phase.phaseId);
      const candidate = game.chooseLiving((player) => player.account.seatId !== mobile.account.seatId, mobile);
      await mobile.clearSelection();
      const candidateButton = mobile.page.getByRole('button').filter({ hasText: candidate.account.displayName }).filter({ hasText: 'Living player' }).first();
      await candidateButton.focus();
      await candidateButton.press('Space');
      await expect(candidateButton).toHaveAttribute('aria-pressed', 'true');
      const saveButton = mobile.page.getByRole('button', { name: 'Save response', exact: true });
      await saveButton.focus();
      await expect(saveButton).toBeFocused();
      await saveButton.press('Enter');
      await expect(saveButton).toBeEnabled();
      expect(await mobile.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 390, height: 844 });
      await mobile.reload();
      expect((await mobile.dashboard()).currentAction?.targetIds).toEqual([candidate.account.seatId]);

      const proposal = await game.lockAndPropose(phase.phaseId);
      expect(proposal.outcome.eliminations.length).toBeLessThanOrEqual(1);
      await mobile.reload();
      await expect(mobile.page.getByRole('button', { name: 'Save response', exact: true })).toHaveCount(0);
      await game.publish(phase.phaseId);
      await refreshPlayers(game);
      await expect(mobile.page.getByRole('heading', { name: /The village is between phases\.|The village is voting\.|Night has fallen\.|The campaign is complete\./u })).toBeVisible();
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });
});
