import { expect, test } from '@playwright/test';
import { BrowserGame, closeSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 900_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

async function refreshPlayers(game: BrowserGame): Promise<void> {
  await Promise.all(game.players.map((player) => player.reload()));
}

test.describe('browser regression coverage for private outcomes and Hunter review', () => {
  test('player timeline redacts private Night resolution fields', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser regression privacy redaction' });
    try {
      const day = await game.openPhase('DAY');
      const dayLock = await game.lockAndPropose(day.phaseId);
      expect(dayLock.outcome.eliminations).toEqual([]);
      await game.publish(day.phaseId);
      await refreshPlayers(game);

      const night = await game.openPhase('NIGHT');
      await refreshPlayers(game);
      const wolves = game.living().filter((player) => player.account.role === 'WEREWOLF');
      const guard = game.byRole('BODYGUARD')[0];
      const seer = game.byRole('SEER')[0];
      const attackTarget = game.chooseLiving((player) => player.account.role === 'VILLAGER');
      const protectionTarget = attackTarget;
      const investigationTarget = game.chooseLiving((player) => player.account.role === 'WEREWOLF', seer);
      await game.submitConcurrently([
        ...wolves.map((wolf) => ({ player: wolf, target: attackTarget })),
        { player: guard, target: protectionTarget },
        { player: seer, target: investigationTarget },
      ]);
      const proposal = await game.lockAndPropose(night.phaseId);
      expect(proposal.outcome.protectedPlayerIds).toEqual([protectionTarget.account.seatId]);
      const published = await game.publish(night.phaseId);
      expect(published.outcome.eliminations).toEqual([]);
      await game.updateAlive(published.outcome);
      await refreshPlayers(game);

      const ordinary = game.chooseLiving((player) => player.account.role === 'VILLAGER');
      const ordinaryDashboard = await game.assertPlayerPrivacy(ordinary);
      expect(ordinaryDashboard.notifications.some((notification) => notification.type === 'INVESTIGATION_RESULT')).toBe(false);
      const seerDashboard = await game.assertPlayerPrivacy(seer, { allowOwnInvestigation: true });
      expect(seerDashboard.notifications.some((notification) => notification.type === 'INVESTIGATION_RESULT')).toBe(true);
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('reviewed Hunter override reaches the Hunter’s browser permission', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser regression reviewed Hunter permission' });
    try {
      const phase = await game.openPhase('DAY');
      await game.lockAndPropose(phase.phaseId);
      const hunter = game.byRole('HUNTER')[0];
      await expect(game.moderator.page.getByText('Override calculated eliminations', { exact: true })).toBeVisible();
      await game.moderator.page.getByText('Override calculated eliminations', { exact: true }).click();
      await game.moderator.page.getByRole('button', { name: hunter.account.displayName, exact: true }).click();
      await game.moderator.page.getByLabel('Audit reason').fill('Recorded browser regression review.');
      const publishOverride = game.moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${game.gameId}/phases`);
      game.moderator.page.once('dialog', (dialog) => void dialog.accept());
      await game.moderator.page.getByRole('button', { name: 'Publish override', exact: true }).click();
      expect((await publishOverride).status()).toBe(200);
      await hunter.reload();
      expect((await hunter.dashboard()).permission.actionKind).toBe('HUNTER_SHOT');
      await expect(hunter.page.getByText(/final target|Hunter/iu).first()).toBeVisible();
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });
});
