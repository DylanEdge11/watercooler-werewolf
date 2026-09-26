import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_RUN_ID, MODERATOR_EMAIL } from '../constants';
import { closeSharedModerator, getSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 120_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

test('the owner adds and removes a co-moderator, then hands the game to another', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const page = moderator.page;
  const suffix = randomUUID().slice(0, 6);
  const gameName = `Co-moderators ${E2E_RUN_ID} ${suffix}`;
  const helpers = [`helper-a-${E2E_RUN_ID}-${suffix}@e2e.test`, `helper-b-${E2E_RUN_ID}-${suffix}@e2e.test`];

  await page.goto('/moderator');
  await page.getByRole('button', { name: 'Start new setup', exact: true }).click();
  await page.getByLabel('Game name').fill(gameName);
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();

  const access = page.locator('form', { hasText: 'Co-moderator access' });
  const list = access.getByRole('list', { name: 'Moderators' });
  const row = (email: string) => list.getByRole('listitem').filter({ hasText: email });
  await expect(row(MODERATOR_EMAIL)).toContainText('Owner');
  for (const email of helpers) {
    await access.getByLabel('Email').fill(email);
    await access.getByLabel('Moderator password').fill('fictional-helper-password-2026');
    await access.getByRole('button', { name: 'Add co-moderator', exact: true }).click();
    await expect(row(email)).toContainText('Co-moderator');
  }
  // The owner's own row has no actions.
  await expect(row(MODERATOR_EMAIL).getByRole('button')).toHaveCount(0);

  page.once('dialog', (dialog) => void dialog.accept());
  await row(helpers[0]).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `${helpers[0]} was removed from this game.` })).toBeVisible();
  await expect(row(helpers[0])).toHaveCount(0);

  page.once('dialog', (dialog) => void dialog.accept());
  await row(helpers[1]).getByRole('button', { name: 'Make owner', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `${helpers[1]} now owns this game.` })).toBeVisible();
  await expect(row(helpers[1])).toContainText('Owner');
  await expect(row(MODERATOR_EMAIL)).toContainText('Co-moderator');
  // As a co-moderator now, the previous owner sees no moderator actions and no Reset.
  await expect(list.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset to setup', exact: true })).toHaveCount(0);
});
