import { expect, test } from '@playwright/test';
import { E2E_REMOTE } from '../constants';
import { closeSharedModerator, getSharedModerator } from './browser-fixture';

// Moderator sign-in allows 5 attempts per 15 minutes per client. Locally every
// browser used to look like the same client, so after one failed test the
// retries' sign-ins exhausted the allowance and failed every later test too.
test.skip(E2E_REMOTE, 'Hosted runs keep the real per-client limit.');

test.afterAll(async () => {
  await closeSharedModerator();
});

test('a retried or later test can always sign the moderator in again', async ({ browser }) => {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await closeSharedModerator();
    const moderator = await getSharedModerator(browser);
    await expect(moderator.page.getByText('Launch checklist', { exact: true })).toBeVisible();
  }
});
