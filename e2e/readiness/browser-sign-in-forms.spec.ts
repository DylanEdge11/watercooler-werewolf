import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_RUN_ID } from '../constants';
import { E2E_REQUEST_HEADERS, newBrowserContext } from '../transport';
import { closeSharedModerator, getSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 120_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

function countPosts(page: Page, pattern: RegExp): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && pattern.test(new URL(request.url()).pathname)) count += 1;
  });
  return () => count;
}

/**
 * Holds the page's POSTs to `pattern` until released. A wrong PIN is answered
 * in about 20 ms locally, faster than a second key press lands; holding the
 * first answer makes sure the second submit arrives while the first is still
 * in flight, which is the case these checks are about.
 */
async function holdPosts(page: Page, pattern: RegExp): Promise<() => void> {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => pattern.test(url.pathname), async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.fallback();
  });
  return release;
}

test('player sign-in and seat claim send one request per submit and render the invitation on the server', async ({ browser }) => {
  const suffix = randomUUID().slice(0, 6);
  const context = await newBrowserContext(browser);
  const page = await context.newPage();

  // Two quick Enters on the sign-in page make one attempt, not two.
  const logins = countPosts(page, /^\/api\/seats\/login$/u);
  const releaseLogin = await holdPosts(page, /^\/api\/seats\/login$/u);
  await page.goto('/player-login');
  await page.getByLabel('Email or seat code').fill(`nobody-${E2E_RUN_ID}-${suffix}@e2e.test`);
  await page.getByLabel('Six-digit PIN').fill('000000');
  await page.getByLabel('Six-digit PIN').press('Enter');
  await page.getByLabel('Six-digit PIN').press('Enter');
  releaseLogin();
  await expect(page.getByRole('alert').filter({ hasText: 'not accepted' })).toBeVisible();
  expect(logins()).toBe(1);

  // A fictional six-seat roster gives real invitation links.
  const moderator = await getSharedModerator(browser);
  const gameName = `Claim forms ${E2E_RUN_ID} ${suffix}`;
  const created = await moderator.context.request.post('/api/games', {
    headers: E2E_REQUEST_HEADERS,
    data: {
      name: gameName, timezone: 'America/Regina', startDate: '2000-01-01', endDate: '2099-12-31', finalCutoffAt: '2099-12-31T16:00',
      activeWeekdays: [1, 2, 3, 4, 5], schedule: { dayCloses: '16:00', nightCloses: '09:00' },
    },
  });
  expect(created.status()).toBe(201);
  const { gameId } = await created.json() as { gameId: string };
  const roster = await moderator.context.request.post(`/api/games/${gameId}/roster`, {
    headers: E2E_REQUEST_HEADERS,
    data: { csv: ['display_name,email', ...Array.from({ length: 6 }, (_, index) => `Claim Player ${index + 1},claim-${E2E_RUN_ID}-${suffix}-${index + 1}@e2e.test`)].join('\n') },
  });
  expect(roster.status()).toBe(200);
  const { invites } = await roster.json() as { invites: Array<{ displayName: string; claimUrl: string }> };
  const claimPath = new URL(invites[0].claimUrl).pathname;

  // The server-rendered HTML already greets the player and names the game.
  const html = await (await context.request.get(claimPath, { headers: E2E_REQUEST_HEADERS })).text();
  expect(html).toContain(`Welcome, ${invites[0].displayName}.`);
  expect(html).toContain(gameName);
  expect(await (await context.request.get('/claim/not-a-real-invitation', { headers: E2E_REQUEST_HEADERS })).text()).toContain('This private seat link is not valid.');

  // A double click on Claim makes one claim.
  const claims = countPosts(page, /^\/api\/seats\/claim\/[^/]+$/u);
  const releaseClaim = await holdPosts(page, /^\/api\/seats\/claim\/[^/]+$/u);
  await page.goto(claimPath);
  await page.getByLabel('Six-digit PIN').fill('482913');
  await page.getByRole('button', { name: 'Claim my seat', exact: true }).dblclick();
  releaseClaim();
  await expect(page.getByRole('heading', { name: 'Your seat is ready.', exact: true })).toBeVisible();
  expect(claims()).toBe(1);
  await context.close();
});
