import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { E2E_RUN_ID } from '../constants';
import { closeSharedModerator, getSharedModerator } from './browser-fixture';
import { countConsolePolls, createRunningGame, openConsole, waitInConsole } from './console-poll-counter';

const MINUTE = 60_000;
const gameName = (label: string) => `Console polls ${label} ${E2E_RUN_ID} ${randomUUID().slice(0, 6)}`;

test.afterAll(async () => {
  await closeSharedModerator();
});

/** Presses a key: the console counts keys, taps, clicks, and scrolling as someone using the page (moving the pointer alone does not count). */
async function touchTheConsole(page: import('@playwright/test').Page) {
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
}

test('a console left alone stops refreshing after five minutes, except the phases refresh that runs automatic steps, and catches up on the first touch', async ({ browser }) => {
  test.setTimeout(180_000);
  const moderator = await getSharedModerator(browser);
  const name = gameName('idle');
  const { gameId } = await createRunningGame(browser, moderator, name);
  const page = await openConsole(moderator, gameId, name);
  const polls = countConsolePolls(page);
  await page.waitForTimeout(1000);

  // Within five minutes everything refreshes about every 30 seconds.
  const start = polls.now();
  await waitInConsole(page, 4 * MINUTE);
  const early = polls.since(start);
  for (const endpoint of ['gamesList', 'phases', 'operations', 'rooms'] as const) expect(early[endpoint], `${endpoint} while in use`).toBeGreaterThanOrEqual(4);

  // After five minutes with nobody touching it, the games list, the event log and rooms, and the
  // other panels stop. The phases refresh keeps going: it is what runs a due automatic result.
  await waitInConsole(page, 90_000);
  const quiet = polls.now();
  await waitInConsole(page, 10 * MINUTE);
  const idle = polls.since(quiet);
  expect(idle.gamesList).toBe(0);
  expect(idle.operations).toBe(0);
  expect(idle.rooms).toBe(0);
  expect(idle.phases).toBeGreaterThanOrEqual(14);

  // The first touch catches up at once and restarts the refreshing.
  await touchTheConsole(page);
  await expect.poll(() => polls.since(quiet).operations, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  expect(polls.since(quiet).gamesList).toBeGreaterThanOrEqual(1);
  await waitInConsole(page, MINUTE);
  expect(polls.since(quiet).operations).toBeGreaterThanOrEqual(3);
  await page.close();
});

test('a console on a stopped game refreshes nothing, even while someone is using it', async ({ browser }) => {
  test.setTimeout(180_000);
  const moderator = await getSharedModerator(browser);
  const name = gameName('stopped');
  const { gameId, post } = await createRunningGame(browser, moderator, name);
  await post(`/api/games/${gameId}/operations`, { action: 'STOP', reason: 'Console polling check', confirmed: true });
  const page = await openConsole(moderator, gameId, name);
  const polls = countConsolePolls(page);
  await page.waitForTimeout(1000);

  const start = polls.now();
  for (let minute = 0; minute < 10; minute += 1) {
    await touchTheConsole(page);
    await waitInConsole(page, MINUTE);
  }
  expect(polls.since(start)).toEqual({ gamesList: 0, phases: 0, operations: 0, rooms: 0 });
  await page.close();
});

test('a console open when its game is stopped notices and stops refreshing', async ({ browser }) => {
  test.setTimeout(180_000);
  const moderator = await getSharedModerator(browser);
  const name = gameName('stopping');
  const { gameId, post } = await createRunningGame(browser, moderator, name);
  const page = await openConsole(moderator, gameId, name);
  const polls = countConsolePolls(page);
  await page.waitForTimeout(1000);

  // While the game runs and someone is using the console, it refreshes.
  const running = polls.now();
  for (let minute = 0; minute < 2; minute += 1) {
    await touchTheConsole(page);
    await waitInConsole(page, MINUTE);
  }
  expect(polls.since(running).operations).toBeGreaterThanOrEqual(3);
  expect(polls.since(running).phases).toBeGreaterThanOrEqual(3);

  // Another moderator (here, the API) stops it. The console finds out on its next refresh, then goes quiet.
  // Each minute gets a real second or two for the answers to arrive, because the controlled clock fires
  // a minute of timers in a few milliseconds, before the first answer saying "stopped" can come back.
  await post(`/api/games/${gameId}/operations`, { action: 'STOP', reason: 'Console polling check', confirmed: true });
  let quiet = false;
  for (let minute = 0; minute < 6 && !quiet; minute += 1) {
    const before = polls.now();
    await touchTheConsole(page);
    await page.clock.runFor(MINUTE);
    await page.waitForTimeout(1500);
    const made = polls.since(before);
    quiet = made.gamesList + made.phases + made.operations + made.rooms === 0;
  }
  expect(quiet, 'the console noticed the stop and stopped refreshing within a few minutes').toBe(true);
  const stopped = polls.now();
  for (let minute = 0; minute < 8; minute += 1) {
    await touchTheConsole(page);
    await waitInConsole(page, MINUTE);
  }
  expect(polls.since(stopped)).toEqual({ gamesList: 0, phases: 0, operations: 0, rooms: 0 });
  await page.close();
});
