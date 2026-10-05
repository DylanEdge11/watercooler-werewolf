import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_RUN_ID } from '../constants';
import { E2E_REQUEST_HEADERS, newBrowserContext } from '../transport';
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

/** A game with six claimed seats and released roles, made through the API, so the console can be pointed at a running game. */
async function launchedGame(browser: import('@playwright/test').Browser, name: string): Promise<string> {
  const moderator = await getSharedModerator(browser);
  const api = moderator.context.request;
  const post = async <T>(path: string, data: unknown): Promise<T> => {
    const response = await api.post(path, { headers: E2E_REQUEST_HEADERS, data });
    expect(response.ok(), `${path} answered ${response.status()}`).toBe(true);
    return await response.json() as T;
  };
  const suffix = randomUUID().slice(0, 6);
  const { gameId } = await post<{ gameId: string }>('/api/games', {
    name, timezone: 'America/Regina', startDate: '2000-01-01', endDate: '2099-12-31', finalCutoffAt: '2099-12-01T17:00',
    activeWeekdays: [1, 2, 3, 4, 5], schedule: { dayCloses: '16:00', nightCloses: '09:00' }, publicationMode: 'REVIEW',
  });
  const csv = ['display_name,email', ...Array.from({ length: 6 }, (_, index) => `Player ${index + 1},tabs-${index + 1}-${E2E_RUN_ID}-${suffix}@e2e.test`)].join('\n');
  const { invites } = await post<{ invites: Array<{ inviteCode: string }> }>(`/api/games/${gameId}/roster`, { csv });
  for (const [index, invite] of invites.entries()) {
    const claimer = await newBrowserContext(browser);
    try {
      const response = await claimer.request.post(`/api/seats/claim/${encodeURIComponent(invite.inviteCode)}`, { headers: E2E_REQUEST_HEADERS, data: { pin: String(730000 + index) } });
      expect(response.ok()).toBe(true);
    } finally {
      await claimer.close();
    }
  }
  const { batchId } = await post<{ batchId: string }>(`/api/games/${gameId}/assignments`, { action: 'PREVIEW' });
  await post(`/api/games/${gameId}/assignments`, { action: 'RELEASE', batchId });
  return gameId;
}

async function openRunningGame(page: import('@playwright/test').Page, gameId: string, name: string) {
  await page.goto('/moderator');
  await page.getByLabel('Selected game').selectOption(gameId);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  // A running game opens on Run game.
  await expect(page.getByRole('tab', { name: 'Run game', exact: true })).toHaveAttribute('aria-selected', 'true');
}

test('a restore sends the moderator to Setup, which shows what happened and the fresh invitations', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const name = `Console restore ${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;
  const gameId = await launchedGame(browser, name);
  await openRunningGame(page, gameId, name);

  await page.getByRole('tab', { name: 'Safety & records', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON backup', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.json$/u);
  await expect(page.getByRole('status').filter({ hasText: 'Verified JSON backup created' })).toBeVisible();

  // The page is shared with other tests, so the dialog answer is removed again afterwards.
  const answer = (dialog: import('@playwright/test').Dialog) => void (dialog.type() === 'prompt' ? dialog.accept(name) : dialog.accept());
  page.on('dialog', answer);
  try {
    await page.getByRole('button', { name: 'Restore to setup', exact: true }).click();

    // The game is back in setup, so the console moves to Setup: the result and the download come with it.
    await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Backup restored to setup with 6 fresh private seat links' })).toBeVisible();
    const [invites] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download fresh invites', exact: true }).click()]);
    expect(invites.suggestedFilename()).toMatch(/\.csv$/u);
  } finally {
    page.off('dialog', answer);
  }
});

test('a reset sends the moderator to Setup, which says what happened', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const name = `Console reset ${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;
  const gameId = await launchedGame(browser, name);
  await openRunningGame(page, gameId, name);

  await page.getByRole('tab', { name: 'Safety & records', exact: true }).click();
  const answer = (dialog: import('@playwright/test').Dialog) => void (dialog.type() === 'prompt' ? dialog.accept(name) : dialog.accept());
  page.on('dialog', answer);
  try {
    await page.getByRole('button', { name: 'Reset to setup', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Setup', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Game reset to setup state' })).toBeVisible();
  } finally {
    page.off('dialog', answer);
  }
});

test('a link to a tab works while the console is already open', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  await page.goto('/moderator');
  await expect(page.getByRole('tablist', { name: 'Console sections' })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#messages'; });
  await expect(page.getByRole('tab', { name: 'Messages', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => { window.location.hash = '#safety'; });
  await expect(page.getByRole('tab', { name: 'Safety & records', exact: true })).toHaveAttribute('aria-selected', 'true');
});
