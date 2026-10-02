import { expect, test } from '@playwright/test';
import type { RoleComposition } from '../../lib/game/types';
import { BASE_URL, MODERATOR_EMAIL } from '../constants';
import { BrowserGame, closeSharedModerator, verifyExpectedRoleComposition, type BrowserPlayer } from './browser-fixture';
import { livingTarget, runDayElimination, runNight } from './game-steps';

// The hosted UAT browser check: one complete, small game played through eight
// independent player browsers against the deployed Preview. The full 20-player
// browser suite runs in CI against a disposable local server.

const UAT_COMPOSITION: RoleComposition = {
  VILLAGER: 2,
  WEREWOLF: 2,
  SEER: 1,
  BODYGUARD: 1,
  HUNTER: 0,
  MASON: 2,
  APPRENTICE_SEER: 0,
  MAYOR: 0,
  CUPID: 0,
};
const UAT_PLAYER_COUNT = 8;

test.describe.configure({ timeout: 300_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

test('an eight-player game runs from setup to a Village win with private information kept private', async ({ browser }, testInfo) => {
  const game = await BrowserGame.create(browser, testInfo, {
    composition: UAT_COMPOSITION,
    playerCount: UAT_PLAYER_COUNT,
    setupThroughUi: true,
    automaticResults: true,
    mobilePlayerIndex: 0,
  });
  try {
    // Setup: every player claimed a seat and signed in from their own browser,
    // and sees only their own role and their own team.
    verifyExpectedRoleComposition(game.accounts, UAT_COMPOSITION);
    for (const player of game.players) {
      const dashboard = await game.assertPlayerPrivacy(player);
      const expectedTeammates = ['WEREWOLF', 'MASON'].includes(player.account.role)
        ? game.players.filter((candidate) => candidate.account.role === player.account.role && candidate.account.seatId !== player.account.seatId).map((candidate) => candidate.account.seatId).sort()
        : [];
      expect(dashboard.player.teammates.map((teammate) => teammate.id).sort()).toEqual(expectedTeammates);
      await game.assertModeratorOnlyRoutes(player);
      await expect(player.page.locator('.role-orbit .role-medallion')).toBeVisible();
    }
    const [first, other] = game.players;
    await first.page.goto(`${BASE_URL}/?seatId=${encodeURIComponent(other.account.seatId)}`);
    await first.waitForDashboard();
    expect((await first.dashboard()).player.id).toBe(first.account.seatId);

    // The moderator sees who still owes a response and copies a nudge that is safe for a group chat.
    const moderatorPage = game.moderator.page;
    await moderatorPage.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE_URL).origin });
    const copiedNudge = async (expectedCount: number, expectedNames: BrowserPlayer[]): Promise<string> => {
      await moderatorPage.reload();
      await expect(moderatorPage.getByText(`Still to respond · ${expectedCount}`, { exact: true })).toBeVisible({ timeout: 30_000 });
      const list = moderatorPage.locator('.outstanding-list');
      for (const player of expectedNames) await expect(list.getByText(player.account.displayName, { exact: true })).toBeVisible();
      await moderatorPage.getByRole('button', { name: 'Copy nudge message', exact: true }).click();
      await expect(moderatorPage.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
      return moderatorPage.evaluate(() => navigator.clipboard.readText());
    };

    // Day 1: a revised vote and a late vote after the lock; the first Werewolf is eliminated.
    const wolfOne = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
    const firstDay = await runDayElimination(game, wolfOne, {
      revise: true,
      lateSubmission: true,
      afterOpen: async () => {
        const nudge = await copiedNudge(UAT_PLAYER_COUNT, game.living());
        expect(nudge).toMatch(/^Day \d+ ballot closes .+ Still to vote: /u);
        for (const player of game.living()) expect(nudge).toContain(player.account.displayName);
      },
    });
    expect(firstDay.published.winner).toBeNull();

    // This game opted in to automatic results at setup: it publishes 60 minutes after calculation unless paused.
    const automation = moderatorPage.locator('.automation-block');
    await moderatorPage.reload();
    await expect(automation.getByRole('status')).toHaveText('Automatic: each phase you open locks at its deadline and publishes 60 minutes later unless you act.', { timeout: 30_000 });
    await automation.getByRole('button', { name: 'Pause automation', exact: true }).click();
    await expect(automation.getByRole('status')).toHaveText(/^Paused\. Deadlines still close voting, but nothing calculates or publishes on its own/u);
    const watcher = game.living().at(-1)!;
    await watcher.reload();
    await expect(watcher.page.locator('.deadline-card')).toContainText('The schedule is paused');
    await automation.getByRole('button', { name: 'Resume automation', exact: true }).click();
    await expect(automation.getByRole('button', { name: 'Pause automation', exact: true })).toBeVisible();

    // The elimination schedule names the next phase a change affects. One per Day and Night keeps this game's slots.
    const eliminations = moderatorPage.locator('.schedule-block');
    await expect(eliminations.locator('.schedule-status')).toHaveText('Latest phase: Day 1. A saved change applies from Night 1, the next phase to open. Phases already opened keep their slots.');
    await eliminations.getByText('Change the elimination schedule', { exact: true }).click();
    await eliminations.getByLabel('Use a fixed elimination schedule').check();
    await eliminations.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await expect(eliminations.getByText('Saved. The change applies from Night 1.', { exact: true })).toBeVisible();
    await expect(eliminations.getByRole('list', { name: 'Elimination schedule' }).first()).toContainText('Day 1 until the end: 1 Day / 1 NightCurrent');

    // Night 1: the Bodyguard blocks the attack and the Seer finds the last Werewolf.
    const protectedTarget = livingTarget(game, (player) => player.account.role === 'VILLAGER');
    const firstNight = await runNight(game, {
      attackTarget: protectedTarget,
      protectAttack: true,
      afterLock: async () => {
        // While the calculated result waits for review, the console and players see when it will publish.
        await moderatorPage.reload();
        await expect(moderatorPage.locator('.automation-block').getByRole('status')).toHaveText(/^Publishes automatically at .+ unless you publish, override, or pause first\.$/u, { timeout: 30_000 });
        await watcher.reload();
        await expect(watcher.page.locator('.deadline-card')).toContainText(/Results publish by .+ unless the moderator reviews them first\./u);
      },
      afterOpen: async () => {
        const nightActors = game.living().filter((player) => ['WEREWOLF', 'SEER', 'BODYGUARD'].includes(player.account.role));
        const nudge = await copiedNudge(nightActors.length, nightActors);
        expect(nudge).toContain('If your role has a night action, save it before');
        for (const player of game.players) expect(nudge).not.toContain(player.account.displayName);
      },
    });
    expect(firstNight.proposal.outcome.eliminations).toEqual([]);
    const seer = game.byRole('SEER')[0];
    const ordinary = game.chooseLiving((player) => player.account.role === 'VILLAGER');
    await expect(seer.page.getByText(/is a werewolf\./iu)).toBeVisible();
    await expect(ordinary.page.getByText(/is a werewolf\./iu)).toHaveCount(0);
    await game.assertPlayerPrivacy(ordinary);
    await game.assertPlayerPrivacy(seer, { allowOwnInvestigation: true });

    // The moderator opens the Pack room's history and posts in it; the living Werewolf sees it as "Moderator".
    const livingWolf = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
    await moderatorPage.reload();
    await moderatorPage.locator('.room-health-list > div').filter({ hasText: 'Pack room' }).getByRole('button', { name: 'Open room', exact: true }).click();
    const roomHistory = moderatorPage.locator('.room-history');
    await expect(roomHistory.getByRole('button', { name: 'Pack room', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await roomHistory.getByLabel('Message as Moderator').fill('The moderator can read this room.');
    await roomHistory.getByRole('button', { name: 'Post as Moderator', exact: true }).click();
    await expect(roomHistory.locator('.chat-line.moderator')).toContainText('The moderator can read this room.');
    await livingWolf.reload();
    const wolfRoom = livingWolf.page.locator('#private-room .chat-line.moderator');
    await expect(wolfRoom).toContainText('Moderator', { timeout: 30_000 });
    await expect(wolfRoom).toContainText('The moderator can read this room.');
    await expect(livingWolf.page.locator('#private-room')).not.toContainText(MODERATOR_EMAIL);
    await roomHistory.getByRole('button', { name: 'Close', exact: true }).click();

    // The Town Hall: living players post for everyone, newest first; an eliminated player reads it but can't post.
    const speaker = game.chooseLiving((player) => player.account.role === 'VILLAGER');
    const speakerHall = speaker.page.locator('#town-hall');
    for (const body of ['First Town Hall note.', 'Second Town Hall note.']) {
      await speakerHall.getByLabel('Message', { exact: true }).fill(body);
      await speakerHall.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(speakerHall.locator('.chat-line').first()).toContainText(body);
    }
    await expect(speakerHall.locator('.chat-line').last()).toContainText('First Town Hall note.');
    await wolfOne.reload();
    const deadHall = wolfOne.page.locator('#town-hall');
    await expect(deadHall.locator('.chat-line').first()).toContainText('Second Town Hall note.', { timeout: 30_000 });
    await expect(deadHall.getByText('Only living players can post in the Town Hall.', { exact: true })).toBeVisible();
    await expect(deadHall.locator('textarea')).toHaveCount(0);

    // A navigation link to a chat highlights the card for a moment.
    await livingWolf.page.getByRole('link', { name: 'Private room' }).filter({ visible: true }).click();
    await expect(livingWolf.page.locator('#private-room')).toHaveAttribute('data-spotlight', 'true');
    await expect(livingWolf.page.locator('#private-room')).not.toHaveAttribute('data-spotlight', /.*/u, { timeout: 5_000 });

    // Hide role leaves a page like any villager's: no pack room, teammates, or pack link; the Town Hall stays.
    await livingWolf.page.getByRole('button', { name: 'Hide role', exact: true }).click();
    await expect(livingWolf.page.locator('#private-room')).toHaveCount(0);
    await expect(livingWolf.page.locator('#team')).toHaveCount(0);
    await expect(livingWolf.page.getByRole('link', { name: 'Private room' })).toHaveCount(0);
    // This page loaded before the notes were posted; a quiet room refreshes every 30 seconds.
    await expect(livingWolf.page.locator('#town-hall')).toContainText('Second Town Hall note.', { timeout: 40_000 });
    await livingWolf.page.getByRole('button', { name: 'Show role', exact: true }).click();
    await expect(livingWolf.page.locator('#private-room')).toBeVisible();

    // An announcement comes with email and chat copy; player feedback reaches the moderator without a name.
    const announcementForm = moderatorPage.locator('form').filter({ hasText: 'Official announcement' });
    await announcementForm.getByLabel('Title').fill('Office party pause');
    await announcementForm.getByLabel('Message').fill('No votes during the Friday party.');
    await announcementForm.getByRole('button', { name: 'Publish notice', exact: true }).click();
    await expect(moderatorPage.getByText('Its email and chat copy are ready below.', { exact: false })).toBeVisible();
    await expect(moderatorPage.locator('.copy-preview').first()).toHaveText(/^Subject: \[Watercooler Werewolf\] Office party pause/u);
    await moderatorPage.getByRole('button', { name: 'Copy Office party pause for chat', exact: true }).click();
    // The Windows clipboard stores line breaks as CRLF.
    expect((await moderatorPage.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/gu, '\n')).toBe(`*Office party pause*\nNo votes during the Friday party.\n\n${new URL(BASE_URL).origin}`);

    const reviewer = game.living().at(-1)!;
    const feedbackCard = reviewer.page.locator('#feedback');
    await expect(feedbackCard).toContainText('This is private to the moderators.');
    await expect(feedbackCard).not.toContainText(/pilot/iu);
    await feedbackCard.getByLabel('Rating').selectOption('4');
    await feedbackCard.getByLabel('Comment').fill('The nudges help.');
    await feedbackCard.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await expect(feedbackCard.getByRole('status')).toContainText('went privately to the moderators');
    await moderatorPage.reload();
    const feedbackBlock = moderatorPage.locator('.feedback-summary');
    await expect(feedbackBlock).toContainText('The nudges help.', { timeout: 30_000 });
    await expect(feedbackBlock).toContainText('4/5');
    await expect(feedbackBlock).not.toContainText(reviewer.account.displayName);

    // Day 2: the last Werewolf is eliminated and the Village wins.
    const wolfTwo = game.chooseLiving((player) => player.account.role === 'WEREWOLF');
    const finalDay = await runDayElimination(game, wolfTwo);
    expect(finalDay.published.winner).toBe('VILLAGE');
    expect((await game.phases()).game.status).toBe('COMPLETED');

    await Promise.all(game.players.map(async (player) => {
      await player.expectCompleted();
      await player.expectReadOnly();
    }));
    // The full Timeline replaces Today in the main column, on desktop and phone.
    for (const viewer of [game.players[1], game.players[0]]) {
      const timelineButton = viewer.page.getByRole('button', { name: 'Timeline', exact: true }).filter({ visible: true });
      await timelineButton.click();
      const timeline = viewer.page.locator('#full-timeline');
      await expect(timeline.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
      await expect(timeline.getByRole('heading', { name: 'Village wins', exact: true })).toBeVisible();
      const firstDayEntry = timeline.locator('.timeline-full-entry').filter({ hasText: `${wolfOne.account.displayName} eliminated` });
      await expect(firstDayEntry).toContainText('Werewolf · village vote');
      await expect(timeline.locator('details.timeline-votes[open] .vote-ledger-row').first()).toBeVisible();
      // Day 1 is an older ballot: its votes arrive only when it is opened.
      const olderBallot = firstDayEntry.locator('details.timeline-votes');
      await expect(olderBallot).not.toHaveAttribute('open');
      const votesLoaded = viewer.page.waitForResponse((response) => /\/api\/phases\/[^/]+\/votes$/u.test(new URL(response.url()).pathname));
      await olderBallot.locator('summary').click();
      expect((await votesLoaded).status()).toBe(200);
      await expect(olderBallot.locator('.vote-ledger-row').first()).toBeVisible();
      await expect(timeline.locator('.timeline-cap-note')).toHaveCount(0);
      await timeline.getByRole('button', { name: 'Back to today', exact: true }).click();
      await expect(viewer.page.locator('#full-timeline')).toHaveCount(0);
      await expect(viewer.page.locator('#today')).toBeVisible();
    }

    // View votes on an older ballot loads its votes into the dialog.
    {
      const viewer = game.players[1];
      const oldestBallot = viewer.page.locator('#timeline .timeline-trigger').filter({ visible: true }).last();
      await oldestBallot.scrollIntoViewIfNeeded();
      await oldestBallot.click();
      const dialog = viewer.page.getByRole('dialog');
      await expect(dialog.locator('.vote-ledger-row').first()).toBeVisible();
      await dialog.getByRole('button', { name: 'Close vote details' }).click();
      await expect(dialog).toHaveCount(0);
    }

    // A long campaign holds more than the latest 100 updates; the Timeline says so.
    {
      const viewer = game.players[1];
      await viewer.page.route('**/api/player', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), timelineHasMore: true } });
      });
      await viewer.reload();
      await viewer.page.getByRole('button', { name: 'Timeline', exact: true }).filter({ visible: true }).click();
      await expect(viewer.page.locator('#full-timeline .timeline-cap-note')).toHaveText(/^Showing the latest \d+ updates; older ones aren’t shown\.$/u);
      await viewer.page.unroute('**/api/player');
      await viewer.page.getByRole('button', { name: 'Back to today', exact: true }).click();
    }

    const livingPlayer = game.living()[0];
    await game.assertNoActionAfterCompletion(livingPlayer, finalDay.phaseId, game.chooseLiving((player) => player.account.seatId !== livingPlayer.account.seatId, livingPlayer));
    await game.assertHealthy();
  } finally {
    await game.dispose();
  }
});
