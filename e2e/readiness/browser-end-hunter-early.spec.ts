import { expect, test, type Dialog } from '@playwright/test';
import { BrowserGame, closeSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 900_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

test('a moderator can end a waiting Hunter’s turn early, after a confirmation (D41)', async ({ browser }, testInfo) => {
  const game = await BrowserGame.create(browser, testInfo, { name: 'Browser end Hunter early' });
  const page = game.moderator.page;
  const phasesPost = (response: { request(): { method(): string }; url(): string }) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${game.gameId}/phases`;
  // Accepts every prompt except the first "End the Hunter's turn now?", which it declines once and records.
  let declineEnd = false;
  let asked = '';
  const answer = (dialog: Dialog) => {
    if (declineEnd && dialog.message().startsWith('End the Hunter’s turn now?')) {
      declineEnd = false;
      asked = dialog.message();
      void dialog.dismiss();
    } else {
      void dialog.accept();
    }
  };
  page.on('dialog', answer);
  try {
    const day = await game.openPhase('DAY');
    await game.lockAndPropose(day.phaseId);
    const hunter = game.byRole('HUNTER')[0];

    // Override the calculated result so it eliminates the Hunter; the phase then waits for their shot.
    await page.getByText('Override calculated eliminations', { exact: true }).click();
    await page.getByRole('button', { name: hunter.account.displayName, exact: true }).click();
    await page.getByLabel('Audit reason').fill('Recorded browser check of ending the Hunter early.');
    const override = page.waitForResponse(phasesPost);
    await page.getByRole('button', { name: 'Publish override', exact: true }).click();
    expect((await override).status()).toBe(200);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Run the live game', exact: true })).toBeVisible({ timeout: 30_000 });
    const endButton = page.getByRole('button', { name: 'End Hunter’s turn now', exact: true });
    await expect(endButton).toBeVisible({ timeout: 30_000 });

    // Saying no sends nothing and keeps the button.
    let phaseRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/games/${game.gameId}/phases`) phaseRequests += 1;
    });
    declineEnd = true;
    await endButton.click();
    await expect.poll(() => asked).toBe('End the Hunter’s turn now? The Hunter will not get to shoot, and this can’t be undone.');
    expect(phaseRequests).toBe(0);
    await expect(endButton).toBeVisible();

    // Saying yes finalizes with no shot, and the phase is ready to publish.
    const finalize = page.waitForResponse(phasesPost);
    await endButton.click();
    expect((await finalize).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Approve & publish', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(endButton).toHaveCount(0);
    await game.assertHealthy();
  } finally {
    page.off('dialog', answer);
    await game.dispose();
  }
});
