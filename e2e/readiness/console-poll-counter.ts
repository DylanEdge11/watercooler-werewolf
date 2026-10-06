import { randomUUID } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';
import { E2E_RUN_ID } from '../constants';
import { E2E_REQUEST_HEADERS, newBrowserContext } from '../transport';
import type { SharedModerator } from './browser-fixture';

/** The console's refresh requests, by what they load. Each is counted whether the answer was 200 or 304: the database does the same work either way. */
const POLLS = {
  gamesList: /\/api\/games(\?[^/]*)?$/u,
  phases: /\/api\/games\/[^/]+\/phases$/u,
  operations: /\/api\/games\/[^/]+\/operations$/u,
  rooms: /\/api\/games\/[^/]+\/rooms$/u,
} as const;

export type PollCounts = Record<keyof typeof POLLS, number>;

/** Starts counting the console's refresh requests on `page`. */
export function countConsolePolls(page: Page) {
  const totals: PollCounts = { gamesList: 0, phases: 0, operations: 0, rooms: 0 };
  page.on('request', (request) => {
    if (request.method() !== 'GET') return;
    const { pathname, search } = new URL(request.url());
    for (const [name, pattern] of Object.entries(POLLS)) {
      if (pattern.test(pathname + search)) totals[name as keyof PollCounts] += 1;
    }
  });
  return {
    now: (): PollCounts => ({ ...totals }),
    /** The requests made since an earlier `now()`. */
    since: (earlier: PollCounts): PollCounts => ({
      gamesList: totals.gamesList - earlier.gamesList,
      phases: totals.phases - earlier.phases,
      operations: totals.operations - earlier.operations,
      rooms: totals.rooms - earlier.rooms,
    }),
  };
}

/** A game with six claimed seats and released roles, made through the API: it is running, with no phase open yet. */
export async function createRunningGame(browser: Browser, moderator: SharedModerator, name: string): Promise<{ gameId: string; post: <T>(path: string, data: unknown) => Promise<T> }> {
  const post = async <T>(path: string, data: unknown): Promise<T> => {
    const response = await moderator.context.request.post(path, { headers: E2E_REQUEST_HEADERS, data });
    expect(response.ok(), `${path} answered ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  };
  const suffix = randomUUID().slice(0, 6);
  const { gameId } = await post<{ gameId: string }>('/api/games', {
    name, timezone: 'America/Regina', startDate: '2000-01-01', endDate: '2099-12-31', finalCutoffAt: '2099-12-01T17:00',
    activeWeekdays: [1, 2, 3, 4, 5], schedule: { dayCloses: '16:00', nightCloses: '09:00' }, publicationMode: 'REVIEW',
  });
  const csv = ['display_name,email', ...Array.from({ length: 6 }, (_, index) => `Player ${index + 1},polls-${index + 1}-${E2E_RUN_ID}-${suffix}@e2e.test`)].join('\n');
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
  return { gameId, post };
}

/**
 * Opens the moderator console on a game in a new tab of the shared moderator's session, with a controllable clock
 * (Playwright's `page.clock`) so minutes of waiting take a moment. The clock is installed before the page loads,
 * so every timer the console sets is the controlled one.
 */
export async function openConsole(moderator: SharedModerator, gameId: string, gameName: string): Promise<Page> {
  const page = await moderator.context.newPage();
  await page.clock.install();
  await page.goto('/moderator');
  await page.getByLabel('Selected game').selectOption(gameId);
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();
  return page;
}

/** Lets the console's own timers run for `ms` of controlled time, then gives the requests they started a moment to be sent. */
export async function waitInConsole(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms);
  await page.waitForTimeout(400);
}
