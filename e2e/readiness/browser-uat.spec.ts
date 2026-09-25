import { expect, test } from '@playwright/test';
import type { RoleComposition } from '../../lib/game/types';
import { BASE_URL } from '../constants';
import { BrowserGame, closeSharedModerator, verifyExpectedRoleComposition } from './browser-fixture';
import { livingTarget, runDayElimination, runNight } from './game-steps';

// The hosted UAT browser check: one complete, small game played through eight
// independent player browsers against the deployed Preview. The full 20-player
// browser suite runs in CI against a disposable local server.

const UAT_COMPOSITION: RoleComposition = {
  VILLAGER: 2,
  WEREWOLF: 2,
  SEER: 1,
  BODYGUARD: 1,
  HUNTER: 0,
  MASON: 2,
  APPRENTICE_SEER: 0,
  MAYOR: 0,
  CUPID: 0,
};
const UAT_PLAYER_COUNT = 8;

test.describe.configure({ timeout: 300_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

test('an eight-player game runs from setup to a Village win with private information kept private', async ({ browser }, testInfo) => {
  const game = await BrowserGame.create(browser, testInfo, {
    composition: UAT_COMPOSITION,
    playerCount: UAT_PLAYER_COUNT,
    setupThroughUi: true,
    mobilePlayerIndex: 0,
  });
  try {
    // Setup: every player claimed a seat and signed in from their own browser,
    // and sees only their own role and their own team.
    verifyExpectedRoleComposition(game.accounts, UAT_COMPOSITION);
    for (const player of game.players) {
      const dashboard = await game.assertPlayerPrivacy(player);
      const expectedTeammates = ['WEREWOLF', 'MASON'].includes(player.account.role)
        ? game.players.filter((candidate) => candidate.account.role === player.account.role && candidate.account.seatId !== player.account.seatId).map((candidate) => candidate.account.seatId).sort()
        : [];
      expect(dashboard.player.teammates.map((teammate) => teammate.id).sort()).toEqual(expectedTeammates);
      await game.assertModeratorOnlyRoutes(player);
    }
    const [first, other] = game.players;
    await first.page.goto(`${BASE_URL}/?seatId=${encodeURIComponent(other.account.seatId)}`);
    await first.waitForDashboard();
    expect((await first.dashboard()).player.id).toBe(first.account.seatId);

    // Day 1: a revised vote and a late vote after the lock; the first Werewolf is eliminated.
    const wolfOne = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
    const firstDay = await runDayElimination(game, wolfOne, { revise: true, lateSubmission: true });
    expect(firstDay.published.winner).toBeNull();

    // Night 1: the Bodyguard blocks the attack and the Seer finds the last Werewolf.
    const protectedTarget = livingTarget(game, (player) => player.account.role === 'VILLAGER');
    const firstNight = await runNight(game, { attackTarget: protectedTarget, protectAttack: true });
    expect(firstNight.proposal.outcome.eliminations).toEqual([]);
    const seer = game.byRole('SEER')[0];
    const ordinary = game.chooseLiving((player) => player.account.role === 'VILLAGER');
    await expect(seer.page.getByText(/is the werewolf\./iu)).toBeVisible();
    await expect(ordinary.page.getByText(/is the werewolf\./iu)).toHaveCount(0);
    await game.assertPlayerPrivacy(ordinary);
    await game.assertPlayerPrivacy(seer, { allowOwnInvestigation: true });

    // Day 2: the last Werewolf is eliminated and the Village wins.
    const wolfTwo = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
    const finalDay = await runDayElimination(game, wolfTwo);
    expect(finalDay.published.winner).toBe('VILLAGE');
    expect((await game.phases()).game.status).toBe('COMPLETED');

    await Promise.all(game.players.map(async (player) => {
      await player.expectCompleted();
      await player.expectReadOnly();
    }));
    // The full Timeline replaces Today in the main column, on desktop and phone.
    for (const viewer of [game.players[1], game.players[0]]) {
      const timelineButton = viewer.page.getByRole('button', { name: 'Timeline', exact: true }).filter({ visible: true });
      await timelineButton.click();
      const timeline = viewer.page.locator('#full-timeline');
      await expect(timeline.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
      await expect(timeline.getByRole('heading', { name: 'Village wins', exact: true })).toBeVisible();
      const firstDayEntry = timeline.locator('.timeline-full-entry').filter({ hasText: `${wolfOne.account.displayName} eliminated` });
      await expect(firstDayEntry).toContainText('Werewolf · village vote');
      await expect(timeline.locator('details.timeline-votes[open] .vote-ledger-row').first()).toBeVisible();
      await timeline.getByRole('button', { name: 'Back to today', exact: true }).click();
      await expect(viewer.page.locator('#full-timeline')).toHaveCount(0);
      await expect(viewer.page.locator('#today')).toBeVisible();
    }

    const livingPlayer = game.living()[0];
    await game.assertNoActionAfterCompletion(livingPlayer, finalDay.phaseId, game.chooseLiving((player) => player.account.seatId !== livingPlayer.account.seatId, livingPlayer));
    await game.assertHealthy();
  } finally {
    await game.dispose();
  }
});
