import { expect, test } from '@playwright/test';
import { BrowserGame, closeSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 900_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

test('Publish asks first, saying no publishes nothing, and saying yes publishes (D70)', async ({ browser }, testInfo) => {
  const game = await BrowserGame.create(browser, testInfo, { name: 'Browser confirm taps: publish' });
  try {
    const day = await game.openPhase('DAY');
    await game.lockAndPropose(day.phaseId);

    const page = game.moderator.page;
    await page.reload();
    const publishButton = page.getByRole('button', { name: 'Approve & publish', exact: true });
    await expect(publishButton).toBeVisible({ timeout: 30_000 });

    let asked = '';
    let publishRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/games/${game.gameId}/phases`) publishRequests += 1;
    });
    page.once('dialog', (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await publishButton.click();
    await expect.poll(() => asked).toBe('Publish this result? Players will see it right away, and this can’t be undone.');
    await expect(publishButton).toBeVisible();
    expect(publishRequests).toBe(0);

    // Saying yes (the helper accepts the prompt) publishes.
    const published = await game.publish(day.phaseId);
    expect(published.outcome).toBeDefined();
    await game.assertHealthy();
  } finally {
    await game.dispose();
  }
});
