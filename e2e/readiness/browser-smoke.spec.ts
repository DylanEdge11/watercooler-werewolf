import { expect, test } from '@playwright/test';
import { BASE_URL } from '../constants';
import { BrowserTelemetry } from './browser-fixture';
import { newBrowserContext } from '../transport';

test.describe('browser smoke', () => {
  test('public, player, and moderator entry points render without browser errors', async ({ browser }) => {
    const context = await newBrowserContext(browser);
    const page = await context.newPage();
    const telemetry = new BrowserTelemetry();
    telemetry.attach(page, `smoke-${test.info().project.name}`);
    const unauthenticatedStatuses: number[] = [];
    page.on('response', (response) => {
      try {
        const pathname = new URL(response.url()).pathname;
        if (/^\/api\/(?:games|player)(?:\/|$)/u.test(pathname)) {
          unauthenticatedStatuses.push(response.status());
        }
      } catch {
        // Ignore non-URL responses; BrowserTelemetry owns failure reporting.
      }
    });
    // The entry points intentionally probe protected APIs before a session exists.
    // Allow those expected 401 console messages before the first navigation.
    telemetry.allowConsoleError(/status of 401/iu, 8);
    try {
      await page.goto('/moderator');
      await expect(page.getByRole('heading', { name: /Moderator sign-in|Owner setup required/u })).toBeVisible();
      await page.goto('/player-login');
      await expect(page.getByRole('heading', { name: 'Player sign-in', exact: true })).toBeVisible();
      const unauthenticatedPlayer = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/player');
      await page.goto('/');
      expect((await unauthenticatedPlayer).status()).toBe(401);
      expect(unauthenticatedStatuses.length).toBeGreaterThan(0);
      expect(unauthenticatedStatuses.every((status) => status === 401)).toBe(true);
      await expect(page.getByRole('heading', { name: 'Suspicion fits neatly between meetings.', exact: true })).toBeVisible();
      expect(page.url()).toBe(`${BASE_URL}/`);
      telemetry.assertHealthy();
    } finally {
      await context.close();
    }
  });
});
