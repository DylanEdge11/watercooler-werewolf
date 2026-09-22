import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { formatZonedDateTimeLocal } from '../../lib/game/scheduling';
import { BrowserGame, closeSharedModerator, type BrowserPlayer } from './browser-fixture';

test.describe.configure({ timeout: 900_000 });
const captureMode = process.env.CAPTURE_ROLE_SCREENSHOTS;
test.skip(!['1', 'mason'].includes(captureMode ?? ''), 'Run explicitly to capture fictional role-page review images.');

test.afterAll(async () => {
  await closeSharedModerator();
});

const outputDirectory = resolve('docs/images/pilot-role-pages-2026-09-21');

function reviewDeadline(): string {
  return formatZonedDateTimeLocal(new Date(Date.now() + 60 * 60_000), 'America/Regina');
}

async function refreshPlayers(players: BrowserPlayer[]): Promise<void> {
  await Promise.all(players.map((player) => player.reload()));
}

async function enableRoleTheme(player: BrowserPlayer): Promise<void> {
  const theme = player.page.getByRole('switch', { name: /Role theme/u });
  await expect(theme).toHaveAttribute('aria-checked', 'false');
  await theme.click();
  await expect(theme).toHaveAttribute('aria-checked', 'true');
  await expect(player.page.locator('main.role-theme')).toHaveCount(1);
  await player.page.waitForTimeout(350);
}

async function capture(page: Page, fileName: string): Promise<void> {
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; } * { animation: none !important; transition: none !important; }' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.viewportSize();
  await page.waitForTimeout(750);
  const screenshotPath = resolve(outputDirectory, fileName);
  const attempts = Array.from({ length: 5 }, (_, index) => `${screenshotPath}.attempt-${index + 1}.png`);
  for (const attempt of attempts) {
    if (viewport) {
      await page.setViewportSize({ width: viewport.width - 1, height: viewport.height });
      await page.setViewportSize(viewport);
    }
    await page.evaluate(() => {
      document.body.style.opacity = '0.999';
      document.body.getBoundingClientRect();
      document.body.style.opacity = '1';
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: attempt, fullPage: false, animations: 'disabled' });
    await page.waitForTimeout(180);
  }
  const sizes = await Promise.all(attempts.map(async (attempt) => ({ attempt, size: (await stat(attempt)).size })));
  const best = sizes.sort((left, right) => right.size - left.size)[0];
  await copyFile(best.attempt, screenshotPath);
  await Promise.all(attempts.map((attempt) => unlink(attempt)));
}

test('captures every role with the important special-role interactions visible', async ({ browser }, testInfo) => {
  await mkdir(outputDirectory, { recursive: true });
  const game = await BrowserGame.create(browser, testInfo, { name: 'Fictional role-page visual review' });
  try {
    const villager = game.byRole('VILLAGER')[0];
    const mason = game.byRole('MASON')[0];
    const hunter = game.byRole('HUNTER')[0];
    const seer = game.byRole('SEER')[0];
    const bodyguard = game.byRole('BODYGUARD')[0];
    const wolves = game.byRole('WEREWOLF');
    const wolf = wolves[0];
    await Promise.all([villager, mason, hunter, seer, bodyguard, wolf].map((player) => player.page.setViewportSize({ width: 1440, height: 900 })));

    const openingDay = await game.openPhase('DAY', reviewDeadline());
    await refreshPlayers([villager, mason]);
    await villager.prepareTarget(wolf.account);
    await enableRoleTheme(villager);
    await capture(villager.page, 'villager-day-vote.png');
    await mason.prepareTarget(wolf.account);
    await enableRoleTheme(mason);
    await capture(mason.page, 'mason-day-vote.png');
    if (captureMode === 'mason') {
      await game.assertHealthy();
      return;
    }
    await game.lockAndPropose(openingDay.phaseId);
    await game.publish(openingDay.phaseId);

    const firstNight = await game.openPhase('NIGHT', reviewDeadline());
    await refreshPlayers([...wolves, seer, bodyguard]);
    const protectedTarget = game.chooseLiving((player) => player.account.role === 'VILLAGER', bodyguard);
    await wolf.prepareTarget(protectedTarget.account);
    await enableRoleTheme(wolf);
    await capture(wolf.page, 'werewolf-night-target.png');
    await bodyguard.prepareTarget(protectedTarget.account);
    await enableRoleTheme(bodyguard);
    await capture(bodyguard.page, 'bodyguard-night-protection.png');

    await game.submitConcurrently([
      ...wolves.map((player) => ({ player, target: protectedTarget })),
      { player: bodyguard, target: protectedTarget },
      { player: seer, target: wolf },
    ]);
    const firstNightProposal = await game.lockAndPropose(firstNight.phaseId);
    expect(firstNightProposal.outcome.eliminations).toEqual([]);
    const firstNightPublished = await game.publish(firstNight.phaseId);
    await game.updateAlive(firstNightPublished.outcome);

    const bridgeDay = await game.openPhase('DAY', reviewDeadline());
    await game.lockAndPropose(bridgeDay.phaseId);
    await game.publish(bridgeDay.phaseId);
    const secondNight = await game.openPhase('NIGHT', reviewDeadline());
    await seer.reload();
    await seer.prepareTarget(wolf.account);
    await enableRoleTheme(seer);
    await expect(seer.page.getByRole('heading', { name: 'Private result history', exact: true })).toBeVisible();
    await capture(seer.page, 'seer-investigation-and-history.png');
    await game.lockAndPropose(secondNight.phaseId);
    await game.publish(secondNight.phaseId);

    const hunterDay = await game.openPhase('DAY', reviewDeadline());
    await refreshPlayers(game.living());
    const hunterFallback = game.chooseLiving((player) => player.account.seatId !== hunter.account.seatId, hunter);
    await game.submitConcurrently(game.living().map((player) => ({
      player,
      target: player.account.seatId === hunter.account.seatId ? hunterFallback : hunter,
    })));
    const hunterProposal = await game.lockAndPropose(hunterDay.phaseId);
    expect(hunterProposal.outcome.hunterRequiredIds).toContain(hunter.account.seatId);
    await hunter.reload();
    const shotTarget = game.chooseLiving((player) => player.account.seatId !== hunter.account.seatId, hunter);
    await hunter.prepareTarget(shotTarget.account);
    await enableRoleTheme(hunter);
    await expect(hunter.page.getByRole('heading', { name: /final target/iu })).toBeVisible();
    await capture(hunter.page, 'hunter-final-shot.png');

    await game.assertHealthy();
  } finally {
    await game.dispose();
  }
});
