import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_RUN_ID } from '../constants';
import { E2E_REQUEST_HEADERS, newBrowserContext } from '../transport';
import { BrowserTelemetry, closeSharedModerator, getSharedModerator } from './browser-fixture';

test.describe.configure({ timeout: 180_000 });

test.afterAll(async () => {
  await closeSharedModerator();
});

async function startGame(page: Page, gameName: string): Promise<void> {
  await page.goto('/moderator');
  await page.getByRole('button', { name: 'Start new setup', exact: true }).click();
  await page.getByLabel('Game name').fill(gameName);
  await page.getByRole('button', { name: 'Create game', exact: true }).click();
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();
}

/** The quoted fields of one CSV line, in order. */
function csvFields(line: string): string[] {
  return [...line.matchAll(/"((?:[^"]|"")*)"/gu)].map((match) => match[1].replaceAll('""', '"'));
}

test('people sign up from a link, the moderator accepts them, and invite codes work as for any roster', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const suffix = randomUUID().slice(0, 6);
  const gameName = `Sign-ups ${E2E_RUN_ID} ${suffix}`;
  const emailOf = (index: number) => `visitor-${index}-${E2E_RUN_ID}-${suffix}@e2e.test`;
  await startGame(page, gameName);

  // Setup has a Sign-ups card, closed until the moderator opens it.
  const card = page.locator('#setup-signups');
  await expect(card.getByRole('heading', { name: 'Sign-ups', exact: true })).toBeVisible();
  await expect(card.locator('.status-pill')).toHaveText('Not open');
  await card.getByRole('button', { name: 'Open sign-ups', exact: true }).click();
  await expect(card.locator('.status-pill')).toHaveText('Open');
  await expect(page.getByLabel('Next step')).toContainText('Sign-ups are open');
  const link = await card.getByLabel('Public sign-up link', { exact: true }).inputValue();
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]+$/u);
  const code = link.split('/join/')[1];

  // A visitor with no account opens the link and signs up.
  const visitorContext = await newBrowserContext(browser);
  const visitorTelemetry = new BrowserTelemetry();
  try {
    const visitor = await visitorContext.newPage();
    visitorTelemetry.attach(visitor, 'visitor');
    await visitor.goto(link);
    await expect(visitor.getByRole('heading', { name: `Join ${gameName}`, exact: true })).toBeVisible();
    await expect(visitor.getByText(/Sign up to play\. The game starts /u)).toBeVisible();
    await visitor.getByLabel('Your name (other players will see this)').fill('Visitor 1');
    await visitor.getByLabel('Your email (your private seat link is sent here)').fill(emailOf(1));
    await visitor.getByRole('button', { name: 'Sign me up', exact: true }).click();
    await expect(visitor.getByRole('status')).toContainText('You’re on the list.');
    // The page says nothing about anyone else.
    await expect(visitor.getByText(emailOf(1))).toHaveCount(0);

    for (let index = 2; index <= 8; index += 1) {
      const response = await visitorContext.request.post(`/api/join/${code}/signup`, { headers: E2E_REQUEST_HEADERS, data: { displayName: `Visitor ${index}`, email: emailOf(index) } });
      expect(response.ok()).toBe(true);
    }

    // The moderator sees them waiting, with a number on the Setup tab and in the next-step note.
    await page.reload();
    await expect(page.getByLabel('Next step')).toContainText('8 people have signed up');
    await page.getByRole('tab', { name: 'People', exact: true }).click();
    await expect(page.locator('#console-tab-setup .tab-badge')).toHaveText('8');
    await page.getByRole('tab', { name: 'Setup', exact: true }).click();
    const waiting = card.getByRole('list', { name: 'Waiting sign-ups' }).getByRole('listitem');
    await expect(waiting).toHaveCount(8);
    await expect(waiting.filter({ hasText: emailOf(8) })).toContainText('Visitor 8');

    // Decline one, then accept the rest at once.
    await card.getByRole('button', { name: 'Decline Visitor 8', exact: true }).click();
    await expect(waiting).toHaveCount(7);
    await expect(card.locator('summary', { hasText: '1 declined' })).toBeVisible();
    await card.getByRole('button', { name: 'Accept all 7', exact: true }).click();
    await expect(card.getByRole('status').filter({ hasText: '7 players added to the roster.' })).toContainText('standard preset for 7 players');
    await expect(card.locator('summary', { hasText: '7 accepted' })).toBeVisible();
    await expect(page.getByText('0 of 7 claimed')).toBeVisible();

    // Accepted players are ordinary unclaimed seats: invitations can still be emailed or downloaded.
    await expect(page.getByRole('button', { name: /Email invites to 7 unclaimed players/u })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download invite CSV', exact: true }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const rows = Buffer.concat(chunks).toString('utf8').split('\r\n').slice(1).map(csvFields);
    expect(rows).toHaveLength(7);
    const first = rows.find((row) => row[1] === emailOf(1));
    expect(first?.[2]).toMatch(/\/claim\//u);

    // The emailed or downloaded link works like any other: claim the seat with a PIN.
    const claimerContext = await newBrowserContext(browser);
    try {
      const claimer = await claimerContext.newPage();
      await claimer.goto(first![2]);
      await expect(claimer.getByRole('heading', { name: 'Welcome, Visitor 1.', exact: true })).toBeVisible();
      await claimer.getByLabel('Six-digit PIN').fill('135790');
      await claimer.getByRole('button', { name: 'Claim my seat', exact: true }).click();
      await expect(claimer.getByRole('heading', { name: 'Your seat is ready.', exact: true })).toBeVisible();
    } finally {
      await claimerContext.close();
    }

    // Closing sign-ups ends the link without losing the list.
    await card.getByRole('button', { name: 'Close sign-ups', exact: true }).click();
    await expect(card.locator('.status-pill')).toHaveText('Closed');
    await visitor.reload();
    await expect(visitor.getByRole('status')).toContainText(`Sign-ups for ${gameName} are closed.`);
    await expect(visitor.getByRole('button', { name: 'Sign me up', exact: true })).toHaveCount(0);
    await expect(card.locator('summary', { hasText: '7 accepted' })).toBeVisible();
    visitorTelemetry.assertHealthy();
  } finally {
    await visitorContext.close();
  }
});

test('a visitor applies to moderate, the owner approves, and they set up their own sign-in', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const suffix = randomUUID().slice(0, 6);
  const gameName = `Applications ${E2E_RUN_ID} ${suffix}`;
  const applicantEmail = `applicant-${E2E_RUN_ID}-${suffix}@e2e.test`;
  await startGame(page, gameName);

  await page.getByRole('tab', { name: 'People', exact: true }).click();
  const card = page.locator('#moderator-applications');
  await expect(card.getByRole('heading', { name: 'Moderator applications', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Open applications', exact: true }).click();
  await expect(card.locator('.status-pill')).toHaveText('Open');
  const link = await card.getByLabel('Public link for applications', { exact: true }).inputValue();

  const visitorContext = await newBrowserContext(browser);
  const newModeratorContext = await newBrowserContext(browser);
  const telemetry = new BrowserTelemetry();
  try {
    const visitor = await visitorContext.newPage();
    telemetry.attach(visitor, 'applicant');
    await visitor.goto(link);
    await expect(visitor.getByRole('heading', { name: gameName, exact: true })).toBeVisible();
    await expect(visitor.getByRole('heading', { name: 'Help run this game', exact: true })).toBeVisible();
    // Player sign-ups were never opened, so there is no sign-up form on this page.
    await expect(visitor.getByRole('button', { name: 'Sign me up', exact: true })).toHaveCount(0);
    const form = visitor.getByRole('form', { name: 'Apply to moderate' });
    await form.getByLabel('Your name', { exact: true }).fill('Nia Newcomer');
    await form.getByLabel('Your email (your setup link is sent here)').fill(applicantEmail);
    await form.getByLabel('Why you’d like to help (optional)').fill('I ran the last office game.');
    await form.getByRole('button', { name: 'Send my application', exact: true }).click();
    await expect(visitor.getByRole('status')).toContainText('Application sent.');

    // The owner sees a number on People and the application in the list.
    await page.reload();
    await expect(page.locator('#console-tab-people .tab-badge')).toHaveText('1');
    await page.getByRole('tab', { name: 'People', exact: true }).click();
    const waiting = card.getByRole('list', { name: 'Waiting applications' }).getByRole('listitem');
    await expect(waiting).toHaveCount(1);
    await expect(waiting).toContainText('I ran the last office game.');
    await card.getByRole('button', { name: 'Approve Nia Newcomer', exact: true }).click();
    // With the only application decided, the card says nobody is waiting, not that nobody applied.
    await expect(card.getByText('Nobody is waiting for a decision.')).toBeVisible();
    await expect(card.getByRole('status').filter({ hasText: 'Nia Newcomer is approved.' })).toContainText(/nothing was sent/u);
    const setupUrl = (await card.locator('code.recovery-list').innerText()).trim();
    expect(setupUrl).toMatch(/\/moderator\/join\/[A-Za-z0-9_-]+$/u);

    // The applicant chooses their own password and lands in the console as a co-moderator.
    const applicant = await newModeratorContext.newPage();
    telemetry.attach(applicant, 'new-moderator');
    await applicant.goto(setupUrl);
    await expect(applicant.getByRole('heading', { name: 'Set up your moderator sign-in', exact: true })).toBeVisible();
    await expect(applicant.getByText(`You’re approved to moderate ${gameName}.`)).toBeVisible();
    await applicant.getByLabel('Password', { exact: true }).fill('fictional-applicant-password-2026');
    await applicant.getByLabel('Type it again').fill('fictional-applicant-password-2026');
    await applicant.getByRole('button', { name: 'Create my sign-in', exact: true }).click();
    await expect(applicant.getByRole('heading', { name: 'You’re in.', exact: true })).toBeVisible();
    await expect(applicant.getByText(/Save these one-time recovery codes now/u)).toBeVisible();
    await applicant.getByRole('link', { name: 'Open the moderator console', exact: true }).click();
    await expect(applicant.getByText('Launch checklist', { exact: true })).toBeVisible();
    await expect(applicant.locator('select[aria-label="Selected game"] option', { hasText: gameName })).toHaveCount(1);
    // A co-moderator can't take or review applications.
    await applicant.getByRole('tab', { name: 'People', exact: true }).click();
    await expect(applicant.locator('#moderator-applications')).toContainText('Only the game owner can take and review moderator applications.');

    // The owner's list now shows them as a co-moderator.
    await page.reload();
    await page.getByRole('tab', { name: 'People', exact: true }).click();
    await card.locator('summary', { hasText: '1 approved' }).click();
    await expect(card.getByRole('list', { name: 'Approved applications' })).toContainText('co-moderator');
    telemetry.assertHealthy();
  } finally {
    await visitorContext.close();
    await newModeratorContext.close();
  }
});

test('one game can use sign-ups and an imported list together, in that order', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const suffix = randomUUID().slice(0, 6);
  const gameName = `Sign-ups then list ${E2E_RUN_ID} ${suffix}`;
  const listed = Array.from({ length: 6 }, (_, index) => ({ name: `Listed ${index + 1}`, email: `listed-${index + 1}-${E2E_RUN_ID}-${suffix}@e2e.test` }));
  const signedUp = [1, 2].map((index) => ({ name: `Visitor ${index}`, email: `visitor-${index}-${E2E_RUN_ID}-${suffix}@e2e.test` }));
  await startGame(page, gameName);

  // Both ways to add players are on Setup from the start.
  const signups = page.locator('#setup-signups');
  await expect(signups.getByRole('heading', { name: 'Sign-ups', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Import the roster', exact: true })).toBeVisible();
  await signups.getByRole('button', { name: 'Open sign-ups', exact: true }).click();
  await expect(signups.locator('.status-pill')).toHaveText('Open');
  const code = (await signups.getByLabel('Public sign-up link', { exact: true }).inputValue()).split('/join/')[1];

  const visitorContext = await newBrowserContext(browser);
  try {
    // Sign-ups come first: two people sign up from the link and the moderator accepts them.
    for (const person of signedUp) {
      const response = await visitorContext.request.post(`/api/join/${code}/signup`, { headers: E2E_REQUEST_HEADERS, data: { displayName: person.name, email: person.email } });
      expect(response.ok()).toBe(true);
    }
    // The console notices new sign-ups when it next checks in, so allow for that.
    await expect(signups.getByRole('list', { name: 'Waiting sign-ups' }).getByRole('listitem')).toHaveCount(2, { timeout: 45_000 });
    await signups.getByRole('button', { name: 'Accept all 2', exact: true }).click();
    await expect(signups.getByRole('status').filter({ hasText: '2 players added to the roster.' })).toBeVisible();
    await expect(page.getByText('0 of 2 claimed')).toBeVisible();

    // With people on the roster the import adds to them, and replacing is a separate, deliberate button.
    await expect(page.getByRole('note').filter({ hasText: 'added to the 2 players already on the roster, including the 2 you accepted from sign-ups' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create private seats', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Replace the whole roster', exact: true })).toBeVisible();
    await page.getByLabel('Roster CSV').fill(['display_name,email', ...listed.map((person) => `${person.name},${person.email}`), `Visitor 1 again,${signedUp[0].email}`].join('\n'));
    await page.getByRole('button', { name: 'Add these players to the roster', exact: true }).click();
    // The person who is on both is skipped; the six others join the two already there.
    await expect(page.getByRole('status').filter({ hasText: '6 players were added to the roster; 1 already on it was left as they are.' })).toBeVisible();
    await expect(page.getByText('0 of 8 claimed')).toBeVisible();
    await expect(signups.getByText('2 accepted', { exact: true })).toBeVisible();

    // One invite file holds everybody, from the list and from sign-ups alike.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download invite CSV', exact: true }).click(),
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
    const rows = Buffer.concat(chunks).toString('utf8').split('\r\n').slice(1).map(csvFields);
    expect(rows).toHaveLength(8);
    for (const person of [...listed, ...signedUp]) expect(rows.some((row) => row[1] === person.email)).toBe(true);

    // A player from the list and a player from sign-ups claim their seats the same way.
    for (const person of [listed[0], signedUp[0]]) {
      const row = rows.find((candidate) => candidate[1] === person.email)!;
      const claimerContext = await newBrowserContext(browser);
      try {
        const claimer = await claimerContext.newPage();
        await claimer.goto(row[2]);
        await expect(claimer.getByRole('heading', { name: `Welcome, ${person.name}.`, exact: true })).toBeVisible();
        await claimer.getByLabel('Six-digit PIN').fill('864209');
        await claimer.getByRole('button', { name: 'Claim my seat', exact: true }).click();
        await expect(claimer.getByRole('heading', { name: 'Your seat is ready.', exact: true })).toBeVisible();
      } finally {
        await claimerContext.close();
      }
    }
    await expect(page.getByText('2 of 8 claimed')).toBeVisible({ timeout: 45_000 });
  } finally {
    await visitorContext.close();
  }
});

test('an imported list can also come first, and replacing the roster is a confirmed choice', async ({ browser }) => {
  const moderator = await getSharedModerator(browser);
  const { page } = moderator;
  const suffix = randomUUID().slice(0, 6);
  const gameName = `List then sign-ups ${E2E_RUN_ID} ${suffix}`;
  const listed = Array.from({ length: 6 }, (_, index) => `Listed ${index + 1},listed-${index + 1}-${E2E_RUN_ID}-${suffix}@e2e.test`);
  const fresh = Array.from({ length: 6 }, (_, index) => `Fresh ${index + 1},fresh-${index + 1}-${E2E_RUN_ID}-${suffix}@e2e.test`);
  const visitor = { name: 'Visitor One', email: `visitor-1-${E2E_RUN_ID}-${suffix}@e2e.test` };
  await startGame(page, gameName);

  // On an empty roster the button is the one it has always been.
  await page.getByLabel('Roster CSV').fill(['display_name,email', ...listed].join('\n'));
  await page.getByRole('button', { name: 'Create private seats', exact: true }).click();
  await expect(page.getByText('0 of 6 claimed')).toBeVisible();

  const signups = page.locator('#setup-signups');
  await signups.getByRole('button', { name: 'Open sign-ups', exact: true }).click();
  await expect(signups.locator('.status-pill')).toHaveText('Open');
  const code = (await signups.getByLabel('Public sign-up link', { exact: true }).inputValue()).split('/join/')[1];
  const visitorContext = await newBrowserContext(browser);
  try {
    const response = await visitorContext.request.post(`/api/join/${code}/signup`, { headers: E2E_REQUEST_HEADERS, data: { displayName: visitor.name, email: visitor.email } });
    expect(response.ok()).toBe(true);
    await signups.getByRole('button', { name: `Accept ${visitor.name}`, exact: true }).click();
    await expect(page.getByText('0 of 7 claimed')).toBeVisible();

    // Declining the confirmation changes nothing.
    await page.getByLabel('Roster CSV').fill(['display_name,email', ...fresh].join('\n'));
    let asked = '';
    page.once('dialog', (dialog) => { asked = dialog.message(); void dialog.dismiss(); });
    await page.getByRole('button', { name: 'Replace the whole roster', exact: true }).click();
    await expect.poll(() => asked).toContain('That includes the 1 person you accepted from sign-ups');
    await expect(page.getByText('0 of 7 claimed')).toBeVisible();

    // Confirming starts over from the list; the accepted person goes back to waiting.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Replace the whole roster', exact: true }).click();
    await expect(page.getByText('0 of 6 claimed')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '6 private seats created.' })).toBeVisible();
    await expect(signups.getByRole('list', { name: 'Waiting sign-ups' }).getByRole('listitem')).toHaveCount(1);
  } finally {
    await visitorContext.close();
  }
});
