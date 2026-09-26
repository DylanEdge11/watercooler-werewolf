import { expect, test } from '@playwright/test';
import { BASE_URL } from '../constants';
import { newBrowserContext } from '../transport';
import { BrowserGame, closeSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 300_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

test('the signed-in dashboard arrives rendered, with the role concealed unless this seat chose to show it', async ({ browser }, testInfo) => {
  const game = await BrowserGame.create(browser, testInfo, {
    playerCount: 6,
    composition: { VILLAGER: 3, WEREWOLF: 1, SEER: 1, BODYGUARD: 1, HUNTER: 0, MASON: 0, APPRENTICE_SEER: 0, MAYOR: 0, CUPID: 0 },
  });
  const player = game.players[0];
  const storageState = await player.context.storageState();
  // Block the app's JavaScript so React never runs: only what the server rendered shows.
  // (Next's small inline script still swaps the streamed page in over the loading frame.)
  const serverOnly = await newBrowserContext(browser, { storageState });
  await serverOnly.route(/\/_next\/static\/chunks\//u, (route) => route.abort());
  const page = await serverOnly.newPage();
  const setVisibility = (value?: string) => value
    ? serverOnly.addCookies([{ name: 'ww_role_visibility', value, url: BASE_URL }])
    : serverOnly.clearCookies({ name: 'ww_role_visibility' });

  // No remembered choice yet: the page is complete, and the role stays concealed.
  await setVisibility();
  await page.goto('/');
  await expect(page.getByText(player.account.displayName, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The village is between phases.');
  await expect(page.locator('.role-card h2')).toHaveText('Hidden');

  // This seat chose to show it: the server renders the role.
  await setVisibility(`${player.account.seatId}.shown`);
  await page.goto('/');
  await expect(page.locator('.role-card h2')).not.toHaveText('Hidden');

  // This seat chose to hide it, or the cookie belongs to another seat: concealed.
  await setVisibility(`${player.account.seatId}.hidden`);
  await page.goto('/');
  await expect(page.locator('.role-card h2')).toHaveText('Hidden');
  await setVisibility(`${game.players[1].account.seatId}.shown`);
  await page.goto('/');
  await expect(page.locator('.role-card h2')).toHaveText('Hidden');

  // With JavaScript on, the device's own setting applies and polling carries on as before.
  await player.page.goto('/');
  await expect(player.page.getByRole('button', { name: 'Hide role', exact: true })).toBeVisible();
  await serverOnly.close();
  await game.dispose();
});
