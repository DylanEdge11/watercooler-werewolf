import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_PLAYER_COUNT, E2E_RUN_ID } from '../constants';
import { closeSharedModerator, getSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 120_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

function rosterCsv(): string {
  return [
    'display_name,email',
    ...Array.from({ length: E2E_PLAYER_COUNT }, (_, index) => `Setup Player ${index + 1},setup-${E2E_RUN_ID}-${index + 1}@e2e.test`),
  ].join('\n');
}

test('keeps setup drafts scoped, supports safe restart, and exposes another game', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const firstName = `Setup navigation ${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;
  const secondName = `Setup follow-up ${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;
  await moderator.page.goto('/moderator');

  await moderator.page.getByRole('button', { name: 'Start new setup', exact: true }).click();
  await moderator.page.getByLabel('Game name').fill(firstName);
  const firstCreate = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/games');
  await moderator.page.getByRole('button', { name: 'Create game', exact: true }).click();
  const firstGameId = (await (await firstCreate).json() as { gameId: string }).gameId;
  await expect(moderator.page.getByRole('heading', { name: firstName, exact: true })).toBeVisible();
  await expect(moderator.page.getByText('Minimum 6 · up to 80 private seats', { exact: true })).toBeVisible();

  await moderator.page.getByRole('button', { name: /Game schedule/u }).click();
  await expect(moderator.page.getByRole('heading', { name: 'Game schedule', exact: true })).toBeVisible();
  await moderator.page.getByLabel('Day ballot closes').fill('15:45');
  const scheduleUpdate = moderator.page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/games/${firstGameId}/schedule`);
  await moderator.page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  expect((await scheduleUpdate).status()).toBe(200);
  await expect(moderator.page.getByText('Game schedule updated.', { exact: false })).toBeVisible();
  await moderator.page.getByRole('button', { name: 'Close schedule', exact: true }).click();

  await moderator.page.getByLabel('Roster CSV').fill(rosterCsv());
  const rosterImport = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${firstGameId}/roster`);
  await moderator.page.getByRole('button', { name: 'Create private seats', exact: true }).click();
  expect((await rosterImport).status()).toBe(200);
  await expect(moderator.page.getByText(`0 of ${E2E_PLAYER_COUNT} claimed`, { exact: true })).toBeVisible();

  const villager = moderator.page.getByRole('spinbutton', { name: 'Villager', exact: true });
  await villager.fill('11');
  await expect.poll(() => villager.inputValue(), { timeout: 15_000 }).toBe('11');

  moderator.page.once('dialog', (dialog) => dialog.accept());
  await moderator.page.getByRole('button', { name: 'Cancel setup and start new game', exact: true }).click();
  await expect(moderator.page.getByRole('heading', { name: 'Schedule the campaign', exact: true })).toBeVisible();
  await expect(moderator.page.getByText('The unfinished setup was cancelled.', { exact: false })).toBeVisible();

  await moderator.page.getByLabel('Game name').fill(secondName);
  const secondCreate = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/games');
  await moderator.page.getByRole('button', { name: 'Create game', exact: true }).click();
  const secondGameId = (await (await secondCreate).json() as { gameId: string }).gameId;
  await expect(moderator.page.getByRole('heading', { name: secondName, exact: true })).toBeVisible();
  await expect(moderator.page.getByLabel('Selected game')).toHaveValue(secondGameId);

  await moderator.page.getByLabel('Selected game').selectOption(firstGameId);
  await expect(moderator.page.getByRole('heading', { name: firstName, exact: true })).toBeVisible();
  await expect(moderator.page.getByText('CANCELLED', { exact: true })).toBeVisible();
  expect(await moderator.page.getByRole('spinbutton', { name: 'Villager', exact: true }).count()).toBe(0);
  moderator.telemetry.assertHealthy();
});
