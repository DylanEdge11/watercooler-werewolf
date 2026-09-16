import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = (process.env.PILOT_BASE_URL ?? 'http://localhost:3000').replace(/\/$/u, '');
const moderatorEmail = (process.env.PILOT_MODERATOR_EMAIL ?? 'moderator@pilot.test').trim().toLowerCase();
const moderatorPassword = process.env.PILOT_MODERATOR_PASSWORD ?? '';
const parsedBaseUrl = new URL(baseUrl);

if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
  throw new Error('PILOT_BASE_URL must be an http:// or https:// preview URL.');
}
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
if (!localHosts.has(parsedBaseUrl.hostname) && process.env.PILOT_ALLOW_REMOTE !== 'yes') {
  throw new Error('PILOT_BASE_URL is not local. Set PILOT_ALLOW_REMOTE=yes only for an explicitly approved fictional staging environment; never point this helper at production.');
}

if (process.env.PILOT_ALLOW_MUTATION !== 'yes') {
  throw new Error('This setup creates a disposable game. Re-run with PILOT_ALLOW_MUTATION=yes and fictional .test credentials.');
}
if (!moderatorPassword || moderatorPassword.length < 12) {
  throw new Error('Set PILOT_MODERATOR_PASSWORD to a fictional password of at least 12 characters.');
}

let cookie = '';
function rememberSession(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=]+=[^;,]+)/u);
  const sessionCookies = setCookies
    .map((value) => value.split(';', 1)[0])
    .filter((value) => value.startsWith('ww_mod_session='));
  if (sessionCookies.length) cookie = sessionCookies.at(-1);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('origin', baseUrl);
  if (cookie) headers.set('cookie', cookie);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  rememberSession(response);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${path} (${response.status}): ${data.error ?? text}`);
  return data;
}

const bootstrap = await request('/api/moderators/bootstrap');
if (bootstrap.needsBootstrap) {
  if (!bootstrap.canBootstrap) {
    throw new Error([
      'The local app has no moderator account, but the configured owner has not verified this origin.',
      `Open ${baseUrl}/signin-with-chatgpt?return_to=%2Fmoderator once as the configured site owner, then rerun this command.`,
      'Do not bypass owner verification or use this helper against a production URL.',
    ].join(' '));
  }
  await request('/api/moderators/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ email: moderatorEmail, password: moderatorPassword }),
  });
} else {
  await request('/api/moderators/login', {
    method: 'POST',
    body: JSON.stringify({ email: moderatorEmail, password: moderatorPassword }),
  });
}

const now = new Date();
const start = new Date(now.valueOf() + 24 * 60 * 60_000);
const end = new Date(start.valueOf() + 25 * 24 * 60 * 60_000);
const isoDate = (date) => date.toISOString().slice(0, 10);
const game = await request('/api/games', {
  method: 'POST',
  body: JSON.stringify({
    name: `Watercooler Pilot ${new Date().toISOString().slice(0, 16).replaceAll(/[-:T]/gu, '')}`,
    timezone: 'UTC',
    startDate: isoDate(start),
    endDate: isoDate(end),
    finalCutoffAt: `${isoDate(end)}T23:00`,
    activeWeekdays: [1, 2, 3, 4, 5],
    schedule: { dayCloses: '16:00', nightCloses: '09:00' },
  }),
});

const rosterCsv = await readFile(resolve('fixtures', 'roster-20.csv'), 'utf8');
const roster = await request(`/api/games/${game.gameId}/roster`, {
  method: 'POST',
  body: JSON.stringify({ csv: rosterCsv }),
});
await mkdir(resolve('outputs'), { recursive: true });
const invitePath = resolve('outputs', `pilot-invites-${game.gameId}.csv`);
await writeFile(invitePath, roster.inviteCsv, 'utf8');
const operations = await request(`/api/games/${game.gameId}/operations`);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  gameId: game.gameId,
  playerCount: roster.playerCount,
  inviteCsv: invitePath,
  status: operations.game?.status,
  next: [
    'Keep the invite CSV private and use separate browser profiles for each fictional player.',
    'Claim every seat, then compose/randomize/release roles from the moderator console.',
    'Delete or move the invite CSV after the rehearsal.',
  ],
}, null, 2));
