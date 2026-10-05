import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatZonedDateTimeLocal } from '../../lib/game/scheduling';
import type { RoleKey } from '../../lib/game/types';
import { MODERATOR_EMAIL, MODERATOR_PASSWORD } from '../constants';
import { browserContextOptions, newRequestContext } from '../transport';

/*
 * Captures the /guide screenshots and the raw walkthrough video from a
 * disposable local game with fictional players. Run explicitly:
 *
 *   CAPTURE_GUIDE_MEDIA=1 node scripts/run-playwright.mjs --project=chromium --retries=0 e2e/readiness/guide-media.spec.ts
 *
 * Screenshots are written to public/guide/. The raw video is written to
 * work/guide-walkthrough-raw.webm; see docs/TESTING.md (Regenerate the guide media) for the ffmpeg
 * commands that produce the published MP4, WebM, and poster.
 */

test.describe.configure({ timeout: 900_000, retries: 0 });
test.skip(process.env.CAPTURE_GUIDE_MEDIA !== '1', 'Run explicitly to regenerate the /guide screenshots and walkthrough video.');

const VIEWPORT = { width: 1440, height: 900 };
const TIMEZONE = 'America/Regina';
const PUBLIC_GUIDE = resolve('public/guide');
const RAW_VIDEO = resolve('work/guide-walkthrough-raw.webm');
const NARRATOR = 'Alex Morgan';
const BOTS = ['Casey Rivera', 'Morgan Lee', 'Jamie Park', 'Taylor Reed', 'Riley Chen', 'Jordan Blake'];
// Joins through the public sign-up link before the list is imported, so the video shows sign-ups and an imported list in one game.
const NEWCOMER = 'Sam Okafor';
// Applies to co-moderate from the same link.
const HELPER = 'Priya Shah';
const COMPOSITION: Record<RoleKey, number> = {
  VILLAGER: 4, WEREWOLF: 2, SEER: 1, BODYGUARD: 1, HUNTER: 0, MASON: 0, APPRENTICE_SEER: 0, MAYOR: 0, CUPID: 0,
};
const ROLE_NAMES: Record<RoleKey, string> = {
  VILLAGER: 'Villager', WEREWOLF: 'Werewolf', SEER: 'Seer', BODYGUARD: 'Bodyguard', HUNTER: 'Hunter',
  MASON: 'Mason', APPRENTICE_SEER: 'Apprentice Seer', MAYOR: 'Mayor', CUPID: 'Cupid',
};

interface Invite { displayName: string; email: string; claimUrl: string; inviteCode: string }

// A visible cursor and a caption bar, re-created on every navigation. Next's
// development badge is hidden so it does not appear in published media.
const OVERLAY_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById('guide-overlay-style')) return;
    const style = document.createElement('style');
    style.id = 'guide-overlay-style';
    style.textContent = [
      'nextjs-portal { display: none !important; }',
      '#guide-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: rgba(184,50,58,.3); border: 2px solid #b8323a; z-index: 2147483647; pointer-events: none; transition: transform .45s cubic-bezier(.2,.8,.2,1); }',
      '#guide-cursor.down { background: rgba(184,50,58,.7); }',
      '#guide-caption { position: fixed; left: 24px; bottom: 24px; max-width: 470px; background: linear-gradient(170deg, #fdf6e4, #f0e2c0); color: #2b2118; font: italic 600 21px/1.35 var(--ll-font-display), Georgia, serif; padding: 16px 28px; border-radius: 3px; outline: 3px double rgba(43,33,24,.45); outline-offset: -8px; box-shadow: 0 14px 36px rgba(20,12,5,.45); z-index: 2147483646; pointer-events: none; text-align: left; }',
      '#guide-caption:empty { display: none; }',
      '.guide-media-hidden #guide-cursor, .guide-media-hidden #guide-caption, .guide-media-hidden .preview-mode-banner { display: none !important; }',
    ].join('\\n');
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'guide-cursor';
    const saved = JSON.parse(sessionStorage.getItem('guide-cursor') || '[720,450]');
    cursor.style.transform = 'translate(' + saved[0] + 'px,' + saved[1] + 'px)';
    document.body.appendChild(cursor);
    const caption = document.createElement('div');
    caption.id = 'guide-caption';
    caption.textContent = sessionStorage.getItem('guide-caption') || '';
    document.body.appendChild(caption);
    window.addEventListener('mousemove', (event) => {
      cursor.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)';
      sessionStorage.setItem('guide-cursor', JSON.stringify([event.clientX, event.clientY]));
    }, true);
    window.addEventListener('mousedown', () => cursor.classList.add('down'), true);
    window.addEventListener('mouseup', () => cursor.classList.remove('down'), true);
  };
  if (document.body) install(); else document.addEventListener('DOMContentLoaded', install);
})();`;

async function pause(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

async function caption(page: Page, text: string): Promise<void> {
  console.log(`[guide-media] ${text}`);
  await page.evaluate((value) => {
    sessionStorage.setItem('guide-caption', value);
    const element = document.getElementById('guide-caption');
    if (element) element.textContent = value;
  }, text);
}

async function click(page: Page, locator: ReturnType<Page['locator']>, settle = 700): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await pause(page, 550);
  await locator.click();
  await pause(page, settle);
}

async function type(page: Page, locator: ReturnType<Page['locator']>, text: string): Promise<void> {
  await click(page, locator, 200);
  await locator.pressSequentially(text, { delay: 90 });
  await pause(page, 400);
}

/** Saves a guide screenshot as WebP (quality 82), about a quarter of the PNG's size. */
async function shot(page: Page, fileName: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.evaluate(() => document.documentElement.classList.add('guide-media-hidden'));
  await pause(page, 150);
  const png = await page.screenshot({ animations: 'disabled', clip });
  await sharp(png).webp({ quality: 82 }).toFile(resolve(PUBLIC_GUIDE, fileName));
  await page.evaluate(() => document.documentElement.classList.remove('guide-media-hidden'));
}

/** Saves a guide screenshot of one element, however tall, as WebP. */
async function shotElement(page: Page, locator: ReturnType<Page['locator']>, fileName: string): Promise<void> {
  await page.evaluate(() => document.documentElement.classList.add('guide-media-hidden'));
  await pause(page, 150);
  const png = await locator.screenshot({ animations: 'disabled' });
  await sharp(png).webp({ quality: 82 }).toFile(resolve(PUBLIC_GUIDE, fileName));
  await page.evaluate(() => document.documentElement.classList.remove('guide-media-hidden'));
}

/**
 * The capture runs on localhost, but the guide should show an address a moderator would recognise. Swaps the
 * origin shown in the link boxes and the setup-link note for an example one; the page's own data is untouched.
 */
async function maskOrigin(page: Page): Promise<void> {
  await page.evaluate((origin) => {
    const shown = 'https://your-site.example';
    for (const input of document.querySelectorAll<HTMLInputElement>('input[readonly]')) input.value = input.value.replace(origin, shown);
    for (const code of document.querySelectorAll('code.recovery-list')) code.textContent = (code.textContent ?? '').replace(origin, shown);
  }, new URL(page.url()).origin);
}

async function post<T>(context: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await context.post(path, { data });
  const body = await response.json() as T & { error?: string };
  if (!response.ok()) throw new Error(`${path} failed with HTTP ${response.status()}: ${body.error ?? 'unknown error'}`);
  return body;
}

test('captures /guide screenshots and the walkthrough video', async ({ browser }) => {
  await mkdir(PUBLIC_GUIDE, { recursive: true });
  await mkdir(resolve('work'), { recursive: true });

  // Disposable setup through the API: just the game. Its players arrive on screen, sign-ups first and then the list.
  const moderatorApi = await newRequestContext();
  await post(moderatorApi, '/api/moderators/login', { email: MODERATOR_EMAIL, password: MODERATOR_PASSWORD });
  const gameName = 'Friday Coffee Club';
  const { gameId } = await post<{ gameId: string }>(moderatorApi, '/api/games', {
    name: gameName,
    timezone: TIMEZONE,
    startDate: '2026-01-01',
    endDate: '2099-12-31',
    finalCutoffAt: '2099-12-01T17:00',
    activeWeekdays: [1, 2, 3, 4, 5],
    schedule: { dayCloses: '16:00', nightCloses: '09:00' },
  });
  const roster = ['display_name,email', ...[NARRATOR, ...BOTS].map((name) => `${name},${name.toLowerCase().replace(' ', '.')}@example.test`)].join('\n');
  const bots = new Map<string, APIRequestContext>();
  const readSeats = async () => (await (await moderatorApi.get(`/api/games/${gameId}/roster`)).json() as { roster: Array<{ id: string; displayName: string }> }).roster;
  let seats: Array<{ id: string; displayName: string }> = [];
  const seatIdByName = new Map<string, string>();
  const nameBySeatId = new Map<string, string>();

  // Compile every route before recording so the video has no dev-server pauses.
  const warm = await browser.newContext(browserContextOptions({ viewport: VIEWPORT }));
  const warmPage = await warm.newPage();
  for (const path of ['/', '/guide', '/player-login', '/moderator', '/moderator/player-preview', `/claim/warm-up-only`, `/join/warm-up-only`, `/moderator/join/warm-up-only`]) {
    await warmPage.goto(path, { timeout: 180_000 });
    await warmPage.locator('main, .setup-shell, .guide-shell').first().waitFor({ timeout: 180_000 });
    await warmPage.waitForTimeout(1500);
  }
  await warm.close();

  const context = await browser.newContext(browserContextOptions({
    viewport: VIEWPORT,
    recordVideo: { dir: resolve('work/guide-video'), size: VIEWPORT },
  }));
  await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();
  const deadline = formatZonedDateTimeLocal(new Date(Date.now() + 3 * 60 * 60_000), TIMEZONE);

  // 1. Landing page.
  await page.goto('/');
  await caption(page, 'Watercooler Werewolf: hidden roles, played between meetings');
  await pause(page, 3000);
  await page.mouse.move(520, 620);
  await pause(page, 1500);

  // 1. The moderator signs in and opens sign-ups first.
  await page.goto('/moderator');
  await caption(page, '1 · The moderator signs in and opens sign-ups');
  await pause(page, 1200);
  await type(page, page.getByLabel('Email'), MODERATOR_EMAIL);
  await type(page, page.getByLabel('Password'), MODERATOR_PASSWORD);
  await click(page, page.getByRole('button', { name: 'Sign in', exact: true }), 1500);
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tablist', { name: 'Console sections' })).toBeVisible();
  await pause(page, 1200);
  await shot(page, 'moderator-tabs.webp');
  await caption(page, 'Let people sign themselves up from one link');
  const signupsCard = page.locator('#setup-signups');
  await signupsCard.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await pause(page, 1600);
  await type(page, signupsCard.getByLabel('Note on the sign-up page (optional)'), 'Our Friday coffee game. Bring a poker face.');
  await click(page, signupsCard.getByRole('button', { name: 'Save note', exact: true }), 900);
  await click(page, signupsCard.getByRole('button', { name: 'Open sign-ups', exact: true }), 1200);
  await expect(signupsCard.locator('.status-pill')).toHaveText('Open');
  const joinLink = await signupsCard.getByLabel('Public sign-up link', { exact: true }).inputValue();
  await maskOrigin(page);
  await caption(page, 'Share the link anywhere. Nothing is emailed until you accept someone');
  await signupsCard.getByRole('button', { name: 'Copy the public sign-up link', exact: true }).hover();
  await pause(page, 2600);

  await page.goto(joinLink);
  await caption(page, 'A visitor opens the link, enters a name and an email, and signs up');
  await expect(page.getByRole('heading', { name: `Join ${gameName}`, exact: true })).toBeVisible();
  await pause(page, 1400);
  await type(page, page.getByLabel('Your name (other players will see this)'), NEWCOMER);
  await type(page, page.getByLabel('Your email (your private seat link is sent here)'), 'sam.okafor@example.test');
  const joinCard = await page.locator('.auth-card').boundingBox();
  if (!joinCard) throw new Error('The sign-up card was not rendered.');
  await shotElement(page, page.locator('.auth-card'), 'join.webp');
  await click(page, page.getByRole('button', { name: 'Sign me up', exact: true }), 1200);
  await expect(page.getByRole('status')).toContainText('You’re on the list.');
  await caption(page, 'They wait on the list. The moderator decides who joins');
  await pause(page, 2600);

  await page.goto('/moderator');
  await expect(page.getByLabel('Next step')).toContainText('1 person has signed up', { timeout: 30_000 });
  await caption(page, 'The moderator sees who signed up and accepts them');
  await signupsCard.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await pause(page, 1800);
  await maskOrigin(page);
  await shotElement(page, signupsCard, 'moderator-signups.webp');
  const acceptResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/signups/review`);
  await click(page, signupsCard.getByRole('button', { name: `Accept ${NEWCOMER}`, exact: true }), 1400);
  const accepted = await (await acceptResponse).json() as { invites: Invite[] };
  const newcomerInvite = accepted.invites[0];
  if (!newcomerInvite) throw new Error('Accepting the sign-up did not create a seat.');
  await caption(page, 'An accepted player gets an ordinary seat. Invitations work the same way');
  await pause(page, 2600);

  // 2. Then the list is imported on top: the people who signed up keep their seats.
  const importCard = page.locator('#setup-roster');
  await caption(page, '2 · Already have a list? Import it. It is added to the people who signed up');
  await importCard.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await pause(page, 1800);
  await click(page, page.getByLabel('Roster CSV'), 300);
  await page.getByLabel('Roster CSV').fill(roster);
  await pause(page, 1600);
  const importHeading = await importCard.locator('.setup-card-heading').boundingBox();
  const importForm = await importCard.locator('form.form-stack').boundingBox();
  if (!importHeading || !importForm) throw new Error('The import card was not rendered.');
  // A margin of card paper around the heading and form, so the crop does not touch the textarea's edge.
  const margin = 18;
  await shot(page, 'moderator-import.webp', { x: importHeading.x - margin, y: importHeading.y - margin, width: importHeading.width + margin * 2, height: importForm.y + importForm.height - importHeading.y + margin * 2 });
  const addResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/roster`);
  await click(page, page.getByRole('button', { name: 'Add these players to the roster', exact: true }), 1500);
  const { invites } = await (await addResponse).json() as { invites: Invite[] };
  const narratorInvite = invites.find((invite) => invite.displayName === NARRATOR);
  if (!narratorInvite) throw new Error('The narrator invitation was not created.');
  await caption(page, 'Email invites sends each player their own private link');
  await page.locator('.invite-email:not(.roster-edit)').evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await pause(page, 1500);
  await click(page, page.getByText('Waiting on 8 players', { exact: true }), 900);
  // Hover only: the capture server's email settings are placeholders.
  await page.getByRole('button', { name: 'Email invites to 8 unclaimed players', exact: true }).hover();
  await pause(page, 2600);

  // Everyone else claims quietly through the API, like the other bots; the narrator claims on screen next.
  for (const [index, invite] of invites.filter((item) => item.displayName !== NARRATOR).entries()) {
    const botContext = await newRequestContext();
    await post(botContext, `/api/seats/claim/${encodeURIComponent(invite.inviteCode)}`, { pin: String(520000 + index) });
    bots.set(invite.displayName, botContext);
  }
  const newcomerContext = await newRequestContext();
  await post(newcomerContext, `/api/seats/claim/${encodeURIComponent(newcomerInvite.inviteCode)}`, { pin: '520099' });
  bots.set(NEWCOMER, newcomerContext);
  seats = await readSeats();
  for (const seat of seats) { seatIdByName.set(seat.displayName, seat.id); nameBySeatId.set(seat.id, seat.displayName); }

  // 3. The narrator claims a seat.
  await page.goto(narratorInvite.claimUrl);
  await caption(page, '3 · Each player claims a private seat from their invitation');
  await expect(page.getByRole('heading', { name: `Welcome, ${NARRATOR}.` })).toBeVisible();
  await pause(page, 1500);
  await type(page, page.getByLabel('Six-digit PIN'), '482913');
  // Crop to a fixed 760x640 area centred on the claim card.
  const card = await page.locator('.auth-card').boundingBox();
  if (!card) throw new Error('The claim card was not rendered.');
  const centre = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
  await shot(page, 'claim.webp', { x: Math.max(0, centre.x - 380), y: Math.max(0, centre.y - 320), width: 760, height: 640 });
  await click(page, page.getByRole('button', { name: 'Claim my seat', exact: true }), 1500);
  await click(page, page.getByRole('link', { name: 'Enter the game', exact: true }), 500);
  await expect(page.getByText('Your private role', { exact: true })).toBeVisible({ timeout: 30_000 });
  await caption(page, 'Roles stay hidden until the moderator releases them');
  await pause(page, 3000);

  // 3. The moderator balances and releases roles.
  await page.goto('/moderator');
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('8 of 8 claimed', { exact: true })).toBeVisible({ timeout: 30_000 });
  await caption(page, '4 · Everyone has claimed a seat. Choose the roles for this game');
  const villagerCount = page.getByRole('spinbutton', { name: 'Villager', exact: true });
  await villagerCount.scrollIntoViewIfNeeded();
  await pause(page, 1500);
  for (const role of Object.keys(COMPOSITION) as RoleKey[]) {
    const field = page.getByRole('spinbutton', { name: ROLE_NAMES[role], exact: true });
    if ((await field.inputValue()) === String(COMPOSITION[role])) continue;
    await click(page, field, 150);
    await field.fill(String(COMPOSITION[role]));
    await pause(page, 350);
  }
  await click(page, page.getByRole('button', { name: 'Save composition', exact: true }), 1000);
  await expect(page.getByRole('status')).toContainText('Role composition saved');
  const previewResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/assignments`);
  await caption(page, 'Randomize roles, check them privately, then release');
  await click(page, page.getByRole('button', { name: 'Randomize roles', exact: true }), 1800);
  const preview = await (await previewResponse).json() as { assignments: Array<{ seatId: string; role: RoleKey }> };
  const roleBySeatId = new Map(preview.assignments.map((assignment) => [assignment.seatId, assignment.role]));
  await click(page, page.getByRole('button', { name: 'Release roles to players', exact: true }), 600);
  // Releasing roles moves the console to Run game; the batch just released is on the Setup tab.
  await click(page, page.getByRole('tab', { name: 'Setup', exact: true }), 400);
  await page.getByRole('heading', { name: /Review assignment batch/u }).evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await pause(page, 2800);

  // 4. The narrator sees their role.
  await page.goto('/');
  await caption(page, '5 · Each player sees only their own role');
  await expect(page.getByText('Your private role', { exact: true })).toBeVisible({ timeout: 30_000 });
  await pause(page, 1500);
  await pause(page, 2500);

  // 5. The moderator opens the first Day.
  await page.goto('/moderator');
  await caption(page, '6 · The moderator opens a Day ballot with a deadline');
  const livePanel = page.getByRole('heading', { name: 'Run the live game', exact: true });
  await expect(livePanel).toBeVisible({ timeout: 30_000 });
  await livePanel.scrollIntoViewIfNeeded();
  await pause(page, 1500);
  await page.getByLabel('Phase').selectOption('DAY');
  await click(page, page.getByLabel(/Deadline \(/u), 200);
  await page.getByLabel(/Deadline \(/u).fill(deadline);
  await pause(page, 600);
  const openResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/phases`);
  await click(page, page.getByRole('button', { name: 'Open phase', exact: true }), 1500);
  const { phaseId } = await (await openResponse).json() as { phaseId: string };

  // Everyone except the narrator votes out one Werewolf who is not the narrator.
  const narratorSeatId = seatIdByName.get(NARRATOR) ?? '';
  const wolves = [...roleBySeatId].filter(([, role]) => role === 'WEREWOLF').map(([seatId]) => seatId);
  const victimSeatId = wolves.find((seatId) => seatId !== narratorSeatId) ?? wolves[0];
  const victimName = nameBySeatId.get(victimSeatId) ?? '';
  const scapegoatSeatId = seats.find((seat) => seat.id !== victimSeatId && seat.id !== narratorSeatId)?.id ?? '';
  for (const [name, bot] of bots) {
    const target = seatIdByName.get(name) === victimSeatId ? scapegoatSeatId : victimSeatId;
    await post(bot, `/api/phases/${phaseId}/actions`, { actionKind: 'DAY_VOTE', targetIds: [target] });
  }

  // 6. The narrator votes.
  await page.goto('/');
  await caption(page, '7 · Players vote whenever they have a minute');
  await expect(page.getByRole('button', { name: 'Save response', exact: true })).toBeVisible({ timeout: 30_000 });
  await pause(page, 1500);
  const candidate = page.getByRole('button').filter({ hasText: victimName }).filter({ hasText: 'Living player' }).first();
  await click(page, candidate, 900);
  await click(page, page.getByRole('button', { name: 'Save response', exact: true }), 600);
  await expect(page.getByRole('status')).toContainText('Response saved as revision');
  await pause(page, 1800);
  await shot(page, 'player-day-ballot.webp');

  // 7. The moderator locks, reviews, and publishes.
  await page.goto('/moderator');
  await caption(page, '8 · At the deadline, the moderator locks and reviews the result');
  await expect(livePanel).toBeVisible({ timeout: 30_000 });
  await livePanel.scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await click(page, page.getByRole('button', { name: /Lock responses & calculate/u }).first(), 2200);
  const publishButton = page.getByRole('button', { name: 'Approve & publish', exact: true });
  await expect(publishButton).toBeVisible({ timeout: 30_000 });
  await livePanel.scrollIntoViewIfNeeded();
  await pause(page, 800);
  await shot(page, 'moderator-live-game.webp');
  await pause(page, 1800);
  await caption(page, 'Publishing makes the result official for everyone');
  await click(page, publishButton, 2200);

  // 8. The result reaches the players.
  await page.goto('/');
  await caption(page, '9 · The curtain falls: everyone sees who was eliminated and their role');
  const alert = page.getByRole('button', { name: 'I understand', exact: true });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  // Let the whole curtain call play (about three seconds), then hold on it.
  await pause(page, 5200);
  await click(page, alert, 1200);

  // 9. The full Timeline.
  await caption(page, '10 · Timeline shows every result and how everyone voted');
  await click(page, page.getByRole('button', { name: 'Timeline', exact: true }).filter({ visible: true }), 1500);
  await expect(page.locator('#full-timeline')).toBeVisible();
  await pause(page, 2600);
  await shot(page, 'player-timeline.webp');
  await click(page, page.getByRole('button', { name: 'Back to today', exact: true }), 900);

  // 10. Night falls: the moderator opens it, and the special roles act in private.
  await page.goto('/moderator');
  await caption(page, '11 · Night falls. The moderator opens it, and special roles act in private');
  await expect(livePanel).toBeVisible({ timeout: 30_000 });
  await livePanel.scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await click(page, page.getByLabel(/Deadline \(/u), 200);
  await page.getByLabel(/Deadline \(/u).fill(deadline);
  const nightResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/games/${gameId}/phases`);
  await click(page, page.getByRole('button', { name: 'Open phase', exact: true }), 1500);
  const { phaseId: nightId } = await (await nightResponse).json() as { phaseId: string };

  // The living bots with a Night role act: the pack attacks a Villager, the Bodyguard protects them, the Seer looks at the last Werewolf.
  const livingBotsWith = (role: RoleKey) => [...roleBySeatId].filter(([seatId, seatRole]) => seatRole === role && seatId !== victimSeatId && seatId !== narratorSeatId).map(([seatId]) => nameBySeatId.get(seatId) ?? '');
  const livingWolfSeat = wolves.find((seatId) => seatId !== victimSeatId) ?? '';
  const attacked = seats.find((seat) => roleBySeatId.get(seat.id) === 'VILLAGER' && seat.id !== narratorSeatId)?.id ?? '';
  for (const name of livingBotsWith('WEREWOLF')) await post(bots.get(name)!, `/api/phases/${nightId}/actions`, { actionKind: 'WOLF_VOTE', targetIds: [attacked] });
  for (const name of livingBotsWith('BODYGUARD')) await post(bots.get(name)!, `/api/phases/${nightId}/actions`, { actionKind: 'PROTECT', targetIds: [attacked] });
  for (const name of livingBotsWith('SEER')) await post(bots.get(name)!, `/api/phases/${nightId}/actions`, { actionKind: 'INVESTIGATE', targetIds: [livingWolfSeat] });
  await pause(page, 1500);

  // 11. Player choices: special powers first; the pack and the votes are lists to open.
  await caption(page, '12 · Player choices lists special powers first');
  const choices = page.locator('#player-choices');
  await click(page, choices.getByText('Show player choices', { exact: true }), 1200);
  await choices.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await expect(choices.getByRole('region', { name: 'Night 1' }).locator('.choices-powers .outcome-row').first()).toBeVisible({ timeout: 30_000 });
  await pause(page, 2400);
  await shot(page, 'moderator-player-choices.webp');
  await caption(page, 'The pack’s targets and the votes open with one click');
  const packList = choices.getByRole('region', { name: 'Night 1' }).locator('details.choices-group').filter({ hasText: 'Pack targets' });
  if (await packList.count()) await click(page, packList.locator('summary'), 1800);
  await click(page, choices.getByRole('region', { name: 'Day 1' }).locator('details.choices-phase > summary'), 1000);
  await click(page, choices.getByRole('region', { name: 'Day 1' }).locator('details.choices-group').filter({ hasText: 'Day votes' }).locator('summary'), 2200);

  // 13. A helper applies to co-moderate; the owner approves; the newcomer gets a one-time setup link.
  await caption(page, '13 · Helpers can apply to co-moderate, and the owner decides');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await pause(page, 900);
  await click(page, page.getByRole('tab', { name: 'People', exact: true }), 1200);
  const appsCard = page.locator('#moderator-applications');
  await appsCard.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await pause(page, 1500);
  await click(page, appsCard.getByRole('button', { name: 'Open applications', exact: true }), 1200);
  await expect(appsCard.locator('.status-pill')).toHaveText('Open');
  const applyLink = await appsCard.getByLabel('Public link for applications', { exact: true }).inputValue();
  await maskOrigin(page);
  await pause(page, 1600);

  await page.goto(applyLink);
  await caption(page, 'A helper applies from the same link');
  const apply = page.getByRole('form', { name: 'Apply to moderate' });
  await expect(apply).toBeVisible();
  await apply.scrollIntoViewIfNeeded();
  await pause(page, 1200);
  await type(page, apply.getByLabel('Your name', { exact: true }), HELPER);
  await type(page, apply.getByLabel('Your email (your setup link is sent here)'), 'priya.shah@example.test');
  await type(page, apply.getByLabel('Why you’d like to help (optional)'), 'I ran our last office game.');
  await click(page, apply.getByRole('button', { name: 'Send my application', exact: true }), 1200);
  // The game has started, so the page also says sign-ups are closed; look for the application's own confirmation.
  await expect(page.getByRole('status').filter({ hasText: 'Application sent.' })).toBeVisible();
  await pause(page, 2000);

  await page.goto('/moderator');
  await click(page, page.getByRole('tab', { name: 'People', exact: true }), 1200);
  await appsCard.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  await expect(appsCard.getByRole('button', { name: `Approve ${HELPER}`, exact: true })).toBeVisible({ timeout: 30_000 });
  await caption(page, 'The owner approves. A new moderator gets a one-time link to choose their own password');
  await pause(page, 1500);
  await click(page, appsCard.getByRole('button', { name: `Approve ${HELPER}`, exact: true }), 1600);
  await expect(appsCard.locator('code.recovery-list')).toBeVisible();
  // Read the real link before the page shows an example address in its place.
  const setupUrl = (await appsCard.locator('code.recovery-list').innerText()).trim();
  await pause(page, 1400);
  await maskOrigin(page);
  await shotElement(page, appsCard, 'moderator-applications.webp');
  await pause(page, 1800);

  // The setup page, shown without finishing it: finishing would sign this browser in as the helper.
  await page.goto(setupUrl);
  await caption(page, 'They choose a password and become a co-moderator of the game');
  await expect(page.getByRole('heading', { name: 'Set up your moderator sign-in', exact: true })).toBeVisible();
  await pause(page, 1200);
  await type(page, page.getByLabel('Password', { exact: true }), 'a-long-fictional-password');
  await pause(page, 2000);
  await page.goto('/moderator');
  await expect(page.getByRole('tablist', { name: 'Console sections' })).toBeVisible({ timeout: 30_000 });

  // 14. The rest of the console is a tab away.
  await caption(page, '14 · Everything else is a tab away: people, messages, and safety');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await pause(page, 900);
  for (const tabName of ['People', 'Messages', 'Safety & records', 'Run game']) {
    await click(page, page.getByRole('tab', { name: tabName, exact: true }), 1500);
  }
  await caption(page, 'Then the next phase begins. Full rules at /guide');
  await pause(page, 3000);

  const video = page.video();
  await context.close();
  if (!video) throw new Error('The walkthrough video was not recorded.');
  await copyFile(await video.path(), RAW_VIDEO);

  // Role screenshots come from the Player View Studio's synthetic data.
  const studio = await browser.newContext(browserContextOptions({ viewport: VIEWPORT, storageState: await moderatorApi.storageState() }));
  await studio.addInitScript(OVERLAY_SCRIPT);
  const studioPage = await studio.newPage();
  await studioPage.goto('/moderator/player-preview');
  await studioPage.evaluate(() => document.documentElement.classList.add('guide-media-hidden'));
  const roleShots: Array<[string, string, string]> = [
    ['Werewolf', 'night-action', 'role-werewolf.webp'],
    ['Seer', 'night-action', 'role-seer.webp'],
    ['Hunter', 'hunter-follow-up', 'role-hunter.webp'],
    ['Bodyguard', 'night-action', 'role-bodyguard.webp'],
  ];
  for (const [role, scenario, fileName] of roleShots) {
    await studioPage.getByLabel('Player role').selectOption({ label: role });
    await studioPage.getByLabel('Game moment').selectOption(scenario);
    await pause(studioPage, 400);
    await studioPage.locator('.app-shell').evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await pause(studioPage, 400);
    await shot(studioPage, fileName);
  }
  await studio.close();
  await moderatorApi.dispose();
  await Promise.all([...bots.values()].map((bot) => bot.dispose()));
});
