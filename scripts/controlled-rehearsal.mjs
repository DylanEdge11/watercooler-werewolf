import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = (process.env.PILOT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/u, '');
const parsedBaseUrl = new URL(baseUrl);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
if (!localHosts.has(parsedBaseUrl.hostname) && process.env.PILOT_ALLOW_REMOTE !== 'yes') {
  throw new Error('This rehearsal is local by default. Set PILOT_ALLOW_REMOTE=yes only for an explicitly approved fictional staging URL.');
}

const moderatorEmail = (process.env.PILOT_MODERATOR_EMAIL ?? 'moderator@pilot.test').trim().toLowerCase();
const moderatorPassword = process.env.PILOT_MODERATOR_PASSWORD ?? 'fictional-review-password-2026';
let moderatorCookie = '';
const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, pass: Boolean(condition), detail });
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
}

function rememberSession(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=]+=[^;,]+)/u);
  const session = values
    .map((value) => value.split(';', 1)[0])
    .find((value) => value.startsWith('ww_mod_session='));
  if (session) moderatorCookie = session;
}

async function request(path, body, cookie = moderatorCookie) {
  const headers = { origin: baseUrl, cookie, 'content-type': 'application/json' };
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  rememberSession(response);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { response, status: response.status, data, cookie: response.headers.getSetCookie?.().map((value) => value.split(';', 1)[0]).find((value) => value.startsWith('ww_player_session=')) ?? '' };
}

async function must(path, body, cookie = moderatorCookie) {
  const result = await request(path, body, cookie);
  assert.ok(result.status < 400, `${path} returned ${result.status}: ${JSON.stringify(result.data)}`);
  return result;
}

const login = await must('/api/moderators/login', { email: moderatorEmail, password: moderatorPassword }, '');
if (login.cookie) moderatorCookie = login.cookie;
const csv = await readFile(resolve('fixtures', 'roster-20.csv'), 'utf8');
const config = {
  name: `Controlled rehearsal ${Date.now()}`,
  timezone: 'UTC',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
  finalCutoffAt: '2099-01-01T00:00Z',
  activeWeekdays: [1, 2, 3, 4, 5],
  schedule: { dayCloses: '16:00', nightCloses: '09:00' },
};
const gameId = (await must('/api/games', config)).data.gameId;
const gamePath = `/api/games/${gameId}`;
const imported = (await must(`${gamePath}/roster`, { csv })).data;
const players = [];
for (const [index, invite] of imported.invites.entries()) {
  const pin = String(610000 + index);
  const claimed = await must(`/api/seats/claim/${invite.inviteCode}`, { pin }, '');
  const dashboard = await must('/api/player', undefined, claimed.cookie);
  players.push({ ...invite, pin, cookie: claimed.cookie, id: dashboard.data.player.id });
}
check('all fictional seats claimed', players.length === 20);

const originalPreview = (await must(`${gamePath}/assignments`, { action: 'PREVIEW' })).data;
await must(`${gamePath}/assignments`, {
  action: 'SAVE_COMPOSITION',
  composition: { VILLAGER: 11, WEREWOLF: 4, SEER: 1, BODYGUARD: 1, HUNTER: 1, MASON: 2 },
});
const staleRelease = await request(`${gamePath}/assignments`, { action: 'RELEASE', batchId: originalPreview.batchId });
check('composition change rejects stale preview', staleRelease.status === 400);
const freshPreview = (await must(`${gamePath}/assignments`, { action: 'PREVIEW' })).data;
await must(`${gamePath}/assignments`, { action: 'RELEASE', batchId: freshPreview.batchId });
const roleBySeat = new Map(freshPreview.assignments.map((assignment) => [assignment.seatId, assignment.role]));
for (const player of players) player.role = roleBySeat.get(player.id);
check('released composition has four Werewolves', freshPreview.assignments.filter((assignment) => assignment.role === 'WEREWOLF').length === 4);

async function open(kind) {
  return (await must(`${gamePath}/phases`, { action: 'OPEN', kind, closesAt: new Date(Date.now() + 60 * 60_000).toISOString() })).data.phaseId;
}

const hunter = players.find((player) => player.role === 'HUNTER');
const seer = players.find((player) => player.role === 'SEER');
const villager = players.find((player) => player.role === 'VILLAGER');
assert.ok(hunter && seer && villager);
const dayPhase = await open('DAY');
await must(`${gamePath}/phases`, { action: 'LOCK_AND_PROPOSE', phaseId: dayPhase });
const override = await must(`${gamePath}/phases`, {
  action: 'PUBLISH',
  phaseId: dayPhase,
  overrideEliminationIds: [hunter.id],
  overrideReason: 'Controlled rehearsal Hunter follow-up',
});
check('Hunter override pauses for follow-up', override.data.pendingHunter === true);
const hunterDashboard = await must('/api/player', undefined, hunter.cookie);
check('Hunter sees the response window', hunterDashboard.data.phase?.status === 'PENDING_HUNTER');
await must(`/api/phases/${dayPhase}/actions`, { actionKind: 'HUNTER_SHOT', targetIds: [villager.id] }, hunter.cookie);
await must(`${gamePath}/phases`, { action: 'FINALIZE_HUNTER', phaseId: dayPhase });
await must(`${gamePath}/phases`, { action: 'PUBLISH', phaseId: dayPhase });
const phaseHistory = (await must(`${gamePath}/phases`)).data.phases.find((phase) => phase.id === dayPhase);
check('published outcome preserves the override separately', phaseHistory?.proposal?.publishedOutcome?.eliminations.some((entry) => entry.playerId === hunter.id) === true);

const nightPhase = await open('NIGHT');
await must(`/api/phases/${nightPhase}/actions`, { actionKind: 'INVESTIGATE', targetIds: [players.find((player) => player.role === 'WEREWOLF').id] }, seer.cookie);
await must(`${gamePath}/phases`, { action: 'LOCK_AND_PROPOSE', phaseId: nightPhase });
await must(`${gamePath}/phases`, { action: 'PUBLISH', phaseId: nightPhase });
await must(`${gamePath}/announcements`, { title: 'Controlled announcement', body: 'Fictional rehearsal notice.' });
const seerAfterAnnouncement = (await must('/api/player', undefined, seer.cookie)).data;
check('private investigation history survives an announcement', seerAfterAnnouncement.notifications.some((notification) => notification.type === 'INVESTIGATION_RESULT') && seerAfterAnnouncement.notifications.some((notification) => notification.type === 'ANNOUNCEMENT'));

await must(`${gamePath}/operations`, { action: 'STOP', confirmed: true, reason: 'Controlled rehearsal stop' });
const stopped = (await must('/api/player', undefined, seer.cookie)).data;
check('Stop is visible to the player', stopped.game.status === 'STOPPED');
await must(`${gamePath}/operations`, { action: 'RESET', confirmed: true, confirmationName: config.name });
check('Reset invalidates the prior player session', (await request('/api/player', undefined, seer.cookie)).status === 401);
const reimport = await must(`${gamePath}/roster`, { csv });
check('reset then roster re-import succeeds', reimport.data.playerCount === 20);

console.log(JSON.stringify({ ok: true, gameId, checks, note: 'Fictional local/staging data only; no production mutation.' }, null, 2));
