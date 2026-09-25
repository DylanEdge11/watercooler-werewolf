import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_REMOTE, E2E_RUN_ID } from '../constants';
import { E2E_REQUEST_HEADERS } from '../transport';
import { closeSharedModerator, getSharedModerator } from './browser-fixture';

// The invite email result belongs to the game it was sent from. The email
// route is answered by a stub, so nothing is sent; the local server needs no
// SMTP settings.
test.skip(E2E_REMOTE, 'Creates run-owned games and stubs the email route; local only.');

test.afterAll(async () => {
  await closeSharedModerator();
});

test('an invite result never shows on a game the moderator switched to', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const api = page.request;
  const headers = E2E_REQUEST_HEADERS;
  const game = (name: string) => ({
    name, timezone: 'America/Regina', startDate: '2026-01-05', endDate: '2099-01-30', finalCutoffAt: '2099-01-30T16:00',
    activeWeekdays: [1, 2, 3, 4, 5], schedule: { dayCloses: '16:00', nightCloses: '09:00' },
  });
  const suffix = `${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;
  const sentFrom = (await (await api.post('/api/games', { headers, data: game(`Invite source ${suffix}`) })).json() as { gameId: string }).gameId;
  const switchedTo = (await (await api.post('/api/games', { headers, data: game(`Invite other ${suffix}`) })).json() as { gameId: string }).gameId;
  const roster = ['display_name,email', ...[1, 2, 3, 4, 5, 6].map((n) => `Invite Player ${n},invite-${n}-${randomUUID().slice(0, 6)}@e2e.test`)].join('\n');
  expect((await api.post(`/api/games/${sentFrom}/roster`, { headers, data: { csv: roster } })).ok()).toBe(true);

  // Pretend email is configured, and answer the send slowly.
  await page.route(`**/api/games/${sentFrom}/roster`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), emailConfigured: true } });
  });
  let releaseSend = () => {};
  const sendHeld = new Promise<void>((resolve) => { releaseSend = resolve; });
  await page.route(`**/api/games/${sentFrom}/invites`, async (route) => {
    await sendHeld;
    await route.fulfill({ json: { ok: true, sent: 6, results: [] } });
  });

  await page.goto('/moderator');
  await page.getByLabel('Selected game').selectOption(sentFrom);
  const send = page.getByRole('button', { name: 'Email invites to 6 unclaimed players', exact: true });
  await expect(send).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  await send.click();
  await expect(page.getByRole('button', { name: 'Sending…' })).toBeVisible();
  await page.getByLabel('Selected game').selectOption(switchedTo);
  await expect(page.getByLabel('Selected game')).toHaveValue(switchedTo);
  releaseSend();
  await page.waitForResponse((response) => response.url().endsWith(`/api/games/${sentFrom}/invites`));
  await page.waitForTimeout(500);
  await expect(page.getByText(/^Emailed \d+ of/u)).toHaveCount(0);
  await expect(page.getByLabel('Selected game')).toHaveValue(switchedTo);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
