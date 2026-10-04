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

test('a new problem in the event log marks Safety & records until the moderator opens it', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const gameName = `Console badge ${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;

  // The console is given problems as if an email batch had failed. Everything else in the answer is real.
  const problems = [{ id: 'stub-email-1', severity: 'WARNING', source: 'EMAIL', message: 'Day 1 opened: 2 of 8 emails could not be delivered. Check the email settings.', createdAt: '2026-10-04T10:00:00.000Z', storySource: null }];
  await page.route(/\/api\/games\/[^/]+\/operations$/u, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const etag = `"stub-problems-${problems.length}"`;
    if (route.request().headers()['if-none-match'] === etag) return route.fulfill({ status: 304, headers: { etag } });
    const response = await route.fetch({ headers: { ...route.request().headers(), 'if-none-match': '' } });
    const body = await response.json() as { events: unknown[] };
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', etag }, body: JSON.stringify({ ...body, events: [...problems, ...body.events] }) });
  });

  await page.goto('/moderator');
  await page.getByRole('button', { name: 'Start new setup', exact: true }).click();
  await page.getByLabel('Game name').fill(gameName);
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();

  const badge = page.locator('#console-tab-safety .tab-badge');
  await expect(badge).toHaveText('1', { timeout: 30_000 });
  // Screen readers hear what the number means.
  await expect(page.getByRole('tab', { name: 'Safety & records', exact: true })).toHaveAccessibleDescription(/1 new problem needs your attention/u);

  // Opening the log clears the number, and it stays clear on other tabs.
  await page.getByRole('tab', { name: 'Safety & records', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Event log' })).toContainText('2 of 8 emails could not be delivered');
  await page.getByRole('tab', { name: 'People', exact: true }).click();
  await expect(badge).toHaveCount(0);

  // A problem logged after that brings it back, counting only the new one.
  problems.push({ id: 'stub-email-2', severity: 'WARNING', source: 'EMAIL', message: 'Night 1 opened: 1 of 8 emails could not be delivered. Check the email settings.', createdAt: '2026-10-04T11:00:00.000Z', storySource: null });
  await page.evaluate(() => {
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    setHidden(true);
    setHidden(false);
    delete (document as { hidden?: boolean }).hidden;
  });
  await expect(badge).toHaveText('1', { timeout: 30_000 });
  await page.getByRole('tab', { name: 'Safety & records', exact: true }).click();
  await expect(badge).toHaveCount(0);
  await page.unroute(/\/api\/games\/[^/]+\/operations$/u);
});
