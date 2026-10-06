import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_REMOTE, MODERATOR_EMAIL, MODERATOR_PASSWORD } from '../constants';
import { newBrowserContext } from '../transport';
import { BrowserGame, closeSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 900_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

test.describe('screens the audit found wrong (D62, D63, D64)', () => {
  test('a closed phase waits for the moderator in plain words, and a saved response does not follow the player into the next phase', async ({ browser }, testInfo) => {
    const game = await BrowserGame.create(browser, testInfo, { name: 'Browser screens: review card and saved banner' });
    try {
      const day = await game.openPhase('DAY');
      const seer = game.byRole('SEER')[0];
      await seer.reload();
      const target = game.chooseLiving((player) => player.account.role === 'VILLAGER', seer);
      await seer.prepareTarget(target.account);
      await seer.submitPrepared();
      await expect(seer.page.getByText('Response saved as revision 1', { exact: false })).toBeVisible();

      // D63: once the Day locks, the card says it is closed and what is being waited for, not "Closing now" and a status name.
      await game.lockAndPropose(day.phaseId);
      const card = seer.page.locator('.deadline-card');
      await expect(card).toContainText('Waiting for the moderator to publish the result.', { timeout: 90_000 });
      await expect(card).toContainText('Closed');
      await expect(card).not.toContainText('Closing now');
      await expect(card).not.toContainText('PENDING APPROVAL');

      // D62: the player's tab stays open, the Day is published and a Night opens. The Night ballot must not start
      // with the Day's green "Response saved" line.
      const published = await game.publish(day.phaseId);
      await game.updateAlive(published.outcome);
      await game.openPhase('NIGHT');
      await expect(seer.page.getByRole('button', { name: 'Save response', exact: true })).toBeVisible({ timeout: 90_000 });
      await expect(seer.page.getByText('Response saved as revision')).toHaveCount(0);
      await game.assertHealthy();
    } finally {
      await game.dispose();
    }
  });

  test('moderator Sign out returns to the sign-in form and leaves nothing of the console on screen', async ({ browser }) => {
    // Its own browser and client address, so signing out here cannot end the shared moderator session other specs use.
    const address = `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;
    const context = await newBrowserContext(browser, E2E_REMOTE ? {} : { extraHTTPHeaders: { 'x-forwarded-for': address } });
    try {
      const page = await context.newPage();
      await page.goto('/moderator');
      await page.getByLabel('Email').fill(MODERATOR_EMAIL);
      await page.getByLabel('Password').fill(MODERATOR_PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByText('Launch checklist', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Moderator sign-in', exact: true })).toBeVisible();
      await expect(page.getByText('Launch checklist', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
