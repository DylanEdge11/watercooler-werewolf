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
  // A new game gives the Hunter eight hours; the divisors sit under a collapsed Advanced section with a slot preview.
  await expect(moderator.page.getByLabel('Hunter window (hours)')).toHaveValue('8');
  // New games use moderator review; automatic results are opt-in with a 60-minute window.
  await expect(moderator.page.getByLabel('I review and publish each result')).toBeChecked();
  await expect(moderator.page.getByLabel('Publish automatically after a review window')).not.toBeChecked();
  await expect(moderator.page.getByLabel('Review window (minutes)')).toHaveValue('60');
  await moderator.page.getByLabel('Hunter window (hours)').fill('2');
  await expect(moderator.page.getByLabel('Players per Day elimination')).toBeHidden();
  await moderator.page.getByText('Advanced: eliminations per phase', { exact: true }).click();
  await moderator.page.getByLabel('Players per Day elimination').fill('10');
  await expect(moderator.page.getByRole('table', { name: 'Day elimination slots' }).getByRole('row', { name: '11–20 2' })).toBeVisible();
  await expect(moderator.page.getByRole('table', { name: 'Night elimination slots' }).getByRole('row', { name: '31–60 2' })).toBeVisible();
  const scheduleUpdate = moderator.page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/games/${firstGameId}/schedule`);
  await moderator.page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  expect((await scheduleUpdate).status()).toBe(200);
  await expect(moderator.page.getByText('Game schedule updated.', { exact: false })).toBeVisible();
  await moderator.page.getByRole('button', { name: 'Close schedule', exact: true }).click();
  await moderator.page.reload();
  await moderator.page.getByRole('button', { name: /Game schedule/u }).click();
  await expect(moderator.page.getByLabel('Hunter window (hours)')).toHaveValue('2');
  await moderator.page.getByText('Advanced: eliminations per phase', { exact: true }).click();
  await expect(moderator.page.getByLabel('Players per Day elimination')).toHaveValue('10');
  await expect(moderator.page.getByLabel('Players per Night elimination')).toHaveValue('30');
  await moderator.page.getByRole('button', { name: 'Close schedule', exact: true }).click();

  await moderator.page.getByLabel('Roster CSV').fill(rosterCsv());
  const rosterImport = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${firstGameId}/roster`);
  await moderator.page.getByRole('button', { name: 'Create private seats', exact: true }).click();
  expect((await rosterImport).status()).toBe(200);
  await expect(moderator.page.getByText(`0 of ${E2E_PLAYER_COUNT} claimed`, { exact: true })).toBeVisible();
  await expect(moderator.page.getByRole('button', { name: 'Download invite CSV', exact: true })).toBeVisible();
  // Enabled only where SMTP is configured; the .test roster is never emailed either way.
  await expect(moderator.page.getByRole('button', { name: `Email invites to ${E2E_PLAYER_COUNT} unclaimed players`, exact: true })).toBeVisible();
  await moderator.page.getByText(`Waiting on ${E2E_PLAYER_COUNT} players`, { exact: true }).click();
  await expect(moderator.page.locator('.invite-list li').filter({ hasText: 'Setup Player 1' }).first()).toContainText('not emailed');

  // One late joiner is added without touching the other seats, then removed again.
  const addForm = moderator.page.getByRole('form', { name: 'Add a player' });
  await addForm.getByLabel('Display name').fill('Late Joiner');
  await addForm.getByLabel('Email').fill(`late-${E2E_RUN_ID}@e2e.test`);
  const seatAdd = moderator.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${firstGameId}/seats`);
  await addForm.getByRole('button', { name: 'Add player', exact: true }).click();
  expect((await seatAdd).status()).toBe(200);
  await expect(moderator.page.getByText(`0 of ${E2E_PLAYER_COUNT + 1} claimed`, { exact: true })).toBeVisible();
  await expect(moderator.page.getByLabel('Late Joiner’s private link')).toHaveValue(/\/claim\//u);
  await expect(moderator.page.getByText(`Late Joiner was added. The roster now has ${E2E_PLAYER_COUNT + 1} players.`, { exact: false })).toBeVisible();
  moderator.page.once('dialog', (dialog) => dialog.accept());
  const seatRemove = moderator.page.waitForResponse((response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname.startsWith(`/api/games/${firstGameId}/seats/`));
  await moderator.page.getByRole('button', { name: 'Remove Late Joiner', exact: true }).click();
  expect((await seatRemove).status()).toBe(200);
  await expect(moderator.page.getByText(`0 of ${E2E_PLAYER_COUNT} claimed`, { exact: true })).toBeVisible();
  await expect(moderator.page.getByLabel('Late Joiner’s private link')).toHaveCount(0);
  // The invite file keeps everyone else's links after an edit.
  const download = moderator.page.waitForEvent('download');
  await moderator.page.getByRole('button', { name: 'Download invite CSV', exact: true }).click();
  const csv = await (await (await download).createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  expect(csv).toContain('Setup Player 1');
  expect(csv).not.toContain('Late Joiner');

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
