import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_RUN_ID } from '../constants';
import { closeSharedModerator, getSharedModerator } from './browser-fixture';

test.afterAll(async () => {
  await closeSharedModerator();
});

test('the console opens on the right tab, moves between tabs by keyboard, and opens a tab from a link', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const gameName = `Console tabs ${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;

  await page.goto('/moderator');
  await page.getByRole('button', { name: 'Start new setup', exact: true }).click();
  await page.getByLabel('Game name').fill(gameName);
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();

  // A game still being set up opens on Setup, and a note says what to do next.
  const tabs = page.getByRole('tablist', { name: 'Console sections' });
  const tab = (name: string) => tabs.getByRole('tab', { name, exact: true });
  await expect(tab('Setup')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Next step')).toContainText('Next: add your players');
  await expect(page.getByRole('button', { name: 'Go to the roster', exact: true })).toBeVisible();

  // Every tab stays on the page; only the open one is shown.
  await expect(page.locator('#console-panel-setup')).toBeVisible();
  for (const hidden of ['run', 'people', 'messages', 'safety']) await expect(page.locator(`#console-panel-${hidden}`)).toBeHidden();

  // Arrow keys, End, and Home move between the tabs, and each shows its own cards.
  await tab('Setup').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Run game')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /The game hasn.t started yet/u })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tab('People')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Moderators', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(tab('Safety & records')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Danger zone', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Setup')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(tab('Setup')).toHaveAttribute('aria-selected', 'true');

  // Stop and Reset are on Safety & records, not beside everyday controls.
  await expect(page.getByRole('button', { name: 'Stop game', exact: true })).toBeHidden();
  await tab('Safety & records').click();
  await expect(page.getByRole('button', { name: 'Stop game', exact: true })).toBeVisible();

  // Co-moderator access is on People.
  await tab('People').click();
  await expect(page.locator('form', { hasText: 'Co-moderator access' })).toBeVisible();

  // A link opens a tab: /moderator#messages.
  const linked = await page.context().newPage();
  try {
    await linked.goto('/moderator#messages');
    await expect(linked.getByRole('tab', { name: 'Messages', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(linked.getByRole('heading', { name: 'Announcements', exact: true })).toBeVisible();
  } finally {
    await linked.close();
  }
});
