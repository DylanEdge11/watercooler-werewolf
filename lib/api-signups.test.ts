import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  moderator: null as { id: string; email: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({
  getCurrentModerator: async () => shared.moderator,
  createModeratorSession: async () => {},
  preparePlayerSession: async (seatId: string, version: number) => ({
    values: [crypto.randomUUID(), seatId, `token-${seatId}`, version, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => {},
  }),
}));

import { GET as signupsGet, POST as signupsPost } from '../app/api/games/[gameId]/signups/route';
import { POST as reviewPost } from '../app/api/games/[gameId]/signups/review/route';
import { POST as assignmentsPost } from '../app/api/games/[gameId]/assignments/route';
import { POST as rosterPost } from '../app/api/games/[gameId]/roster/route';
import { POST as seatsPost } from '../app/api/games/[gameId]/seats/route';
import { DELETE as seatDelete } from '../app/api/games/[gameId]/seats/[seatId]/route';
import { GET as joinGet } from '../app/api/join/[code]/route';
import { POST as joinSignupPost } from '../app/api/join/[code]/signup/route';
import { POST as claimPost } from '../app/api/seats/claim/[code]/route';
import { sha256 } from './auth/crypto';
import { createBackupRecord, restoreGameBackup } from './backup/snapshot';
import { defaultComposition } from './game/balance';
import { JOIN_COPY } from './game/join-copy';
import { MAX_PLAYERS } from './game/player-count';
import { MAX_OPEN_SIGNUPS } from './game/signups';
import { loadRosterView } from './game/setup-view';

let client: Client;
const ORIGIN = 'http://localhost:3000';

const as = (id: string | null) => { shared.moderator = id ? { id, email: `${id}@pilot.test` } : null; };

function request(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/test`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Reply { status: number; body: Record<string, any>; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any

async function read(response: Response): Promise<Reply> {
  return { status: response.status, body: await response.json() as Record<string, any>, headers: response.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const gameCtx = { params: Promise.resolve({ gameId: 'game' }) };
const manage = async (body: Record<string, unknown>) => read(await signupsPost(request('POST', body), gameCtx));
const view = async () => read(await signupsGet(request('GET'), gameCtx));
const review = async (decision: string, signupIds: string[]) => read(await reviewPost(request('POST', { decision, signupIds }), gameCtx));
const codeCtx = (code: string) => ({ params: Promise.resolve({ code }) });
const page = async (code: string) => read(await joinGet(request('GET'), codeCtx(code)));
const signUp = async (code: string, body: unknown, headers: Record<string, string> = {}) => read(await joinSignupPost(request('POST', body, headers), codeCtx(code)));

async function rows(sql: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  return (await client.execute({ sql, args })).rows as unknown as Array<Record<string, unknown>>;
}
const count = async (sql: string, args: Array<string | number> = []) => Number((await rows(sql, args))[0]?.count);
const events = async (type: string) => rows('SELECT payload_json AS payload FROM game_events WHERE event_type = ?', [type]);

async function openAndGetCode(): Promise<string> {
  const opened = await manage({ action: 'OPEN' });
  expect(opened.status).toBe(200);
  return String(opened.body.link).split('/join/')[1];
}

async function waiting(): Promise<Array<{ id: string; email: string }>> {
  return (await rows("SELECT id, email FROM signups WHERE game_id = 'game' AND status = 'PENDING' ORDER BY created_at, id")) as Array<{ id: string; email: string }>;
}

async function seedSeats(total: number, prefix = 'seat'): Promise<void> {
  const now = '2026-01-01T00:00:00.000Z';
  await client.batch(
    Array.from({ length: total }, (_, index) => ({
      sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,session_version,alive,created_at,updated_at) VALUES (?, 'game', ?, ?, 'INVITED', ?, 1, 1, ?, ?)",
      args: [`${prefix}-${index}`, `Player ${index}`, `${prefix}-${index}@pilot.test`, `hash-${prefix}-${index}`, now, now],
    })),
    'write',
  );
}

async function seedSignups(total: number, startAt = 0): Promise<void> {
  await client.batch(
    Array.from({ length: total }, (_, index) => {
      const n = startAt + index;
      return {
        sql: "INSERT INTO signups (id,game_id,display_name,email,status,created_at) VALUES (?, 'game', ?, ?, 'PENDING', ?)",
        args: [`signup-${n}`, `Visitor ${n}`, `visitor-${n}@pilot.test`, `2026-02-01T00:00:${String(n % 60).padStart(2, '0')}.${String(Math.floor(n / 60)).padStart(3, '0')}Z`],
      };
    }),
    'write',
  );
}

async function seatCount(): Promise<number> {
  return count("SELECT COUNT(*) AS count FROM seats WHERE game_id = 'game' AND status != 'REMOVED'");
}

async function composition(): Promise<Record<string, number>> {
  const result = await rows("SELECT role_key AS roleKey, count FROM game_role_counts WHERE game_id = 'game'");
  return Object.fromEntries(result.map((row) => [String(row.roleKey), Number(row.count)]));
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  const account = (id: string) => ({ sql: `INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('${id}','${id}@pilot.test','x','[]','2026-01-01','2026-01-01')`, args: [] });
  await client.batch([
    account('owner'), account('cora'), account('stranger'),
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Office Campaign','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2026-12-01','owner','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','owner','OWNER','2026-01-01'), ('game','cora','CO_MODERATOR','2026-01-01')", args: [] },
  ], 'write');
  as('owner');
});

afterEach(() => {
  shared.db = null;
  shared.moderator = null;
  client.close();
});

describe('opening and closing sign-ups', () => {
  test('opening gives a public link, and the page then shows the game and nothing else', async () => {
    await manage({ action: 'SET_NOTE', note: 'Lunch-hour game. Bring your poker face.' });
    const opened = await manage({ action: 'OPEN' });
    expect(opened).toMatchObject({ status: 200, body: { ok: true, state: 'OPEN', live: true } });
    expect(opened.body.link).toMatch(/^http:\/\/localhost:3000\/join\/[A-Za-z0-9_-]{8,}$/u);
    expect(await events('SIGNUPS_OPENED')).toHaveLength(1);

    const code = String(opened.body.link).split('/join/')[1];
    const shown = await page(code);
    expect(shown).toMatchObject({ status: 200, body: { ok: true, page: { gameName: 'Office Campaign', startDateLabel: 'Thursday, January 1', note: 'Lunch-hour game. Bring your poker face.', signups: 'OPEN', applications: false } } });
    // The public page is told only what it needs: never an id, an email, or who has signed up.
    expect(Object.keys(shown.body.page).sort()).toEqual(['applications', 'gameName', 'note', 'signups', 'startDateLabel']);
  });

  test('opening again changes nothing', async () => {
    const first = await manage({ action: 'OPEN' });
    const second = await manage({ action: 'OPEN' });
    expect(second.body.link).toBe(first.body.link);
    expect(await events('SIGNUPS_OPENED')).toHaveLength(1);
  });

  test('closing makes the link say closed and refuses new sign-ups; reopening keeps the same link', async () => {
    const code = await openAndGetCode();
    expect(await manage({ action: 'CLOSE' })).toMatchObject({ status: 200, body: { state: 'CLOSED', live: false } });
    expect(await events('SIGNUPS_CLOSED')).toHaveLength(1);
    expect((await page(code)).body.page.signups).toBe('CLOSED');
    const refused = await signUp(code, { displayName: 'Late Larry', email: 'larry@pilot.test' });
    expect(refused).toMatchObject({ status: 409, body: { ok: false, error: JOIN_COPY.closed('Office Campaign') } });
    expect(await count('SELECT COUNT(*) AS count FROM signups')).toBe(0);

    const reopened = await manage({ action: 'OPEN' });
    expect(String(reopened.body.link)).toContain(code);
    expect((await signUp(code, { displayName: 'Larry', email: 'larry@pilot.test' })).status).toBe(200);
  });

  test('closing sign-ups that were never opened is refused, and closing twice is fine', async () => {
    expect(await manage({ action: 'CLOSE' })).toMatchObject({ status: 409, body: { error: 'Sign-ups are not open.' } });
    await manage({ action: 'OPEN' });
    await manage({ action: 'CLOSE' });
    expect((await manage({ action: 'CLOSE' })).status).toBe(200);
    expect(await events('SIGNUPS_CLOSED')).toHaveLength(1);
  });

  test('replacing the link ends the old one', async () => {
    const oldCode = await openAndGetCode();
    const replaced = await manage({ action: 'ROTATE_LINK' });
    const newCode = String(replaced.body.link).split('/join/')[1];
    expect(newCode).not.toBe(oldCode);
    expect((await page(oldCode)).status).toBe(404);
    expect((await signUp(oldCode, { displayName: 'Ada', email: 'ada@pilot.test' })).status).toBe(404);
    expect((await page(newCode)).status).toBe(200);
    expect(await events('SIGNUP_LINK_REPLACED')).toHaveLength(1);
  });

  test('there is no link to replace before sign-ups have been opened', async () => {
    expect(await manage({ action: 'ROTATE_LINK' })).toMatchObject({ status: 409 });
  });

  test('sign-ups can be opened only before roles are randomized', async () => {
    for (const status of ['ASSIGNMENT_PREVIEW', 'ACTIVE', 'CANCELLED']) {
      await client.execute({ sql: "UPDATE games SET status = ? WHERE id = 'game'", args: [status] });
      expect(await manage({ action: 'OPEN' })).toMatchObject({ status: 409, body: { error: expect.stringContaining('before roles are randomized') } });
    }
    expect((await rows("SELECT signup_state AS state FROM games WHERE id = 'game'"))[0].state).toBe('NOT_OPEN');
  });

  test('an open link pauses while roles are randomized and resumes when the roster is unlocked', async () => {
    const code = await openAndGetCode();
    await client.execute("UPDATE games SET status = 'ASSIGNMENT_PREVIEW' WHERE id = 'game'");
    expect((await page(code)).body.page.signups).toBe('CLOSED');
    expect((await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' })).status).toBe(409);
    expect((await view()).body.live).toBe(false);
    await client.execute("UPDATE games SET status = 'REGISTRATION' WHERE id = 'game'");
    expect((await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' })).status).toBe(200);
  });

  test('the note is optional, tidy, and limited in length', async () => {
    expect(await manage({ action: 'SET_NOTE', note: '  Hello   there  ' })).toMatchObject({ status: 200, body: { note: 'Hello there' } });
    expect(await manage({ action: 'SET_NOTE', note: '' })).toMatchObject({ status: 200, body: { note: '' } });
    expect(await manage({ action: 'SET_NOTE', note: 'x'.repeat(301) })).toMatchObject({ status: 400 });
    await client.execute("UPDATE games SET status = 'ACTIVE' WHERE id = 'game'");
    expect(await manage({ action: 'SET_NOTE', note: 'Too late' })).toMatchObject({ status: 409 });
  });

  test('an unknown action is refused', async () => {
    expect((await manage({ action: 'DELETE_EVERYTHING' })).status).toBe(400);
    expect((await manage({})).status).toBe(400);
  });

  test('only a moderator of the game can manage it, and a cross-origin post is refused', async () => {
    as(null);
    expect((await manage({ action: 'OPEN' })).status).toBe(401);
    expect((await view()).status).toBe(401);
    as('stranger');
    expect((await manage({ action: 'OPEN' })).status).toBe(403);
    expect((await view()).status).toBe(403);
    as('cora');
    expect((await manage({ action: 'OPEN' })).status).toBe(200);
    const foreign = await read(await signupsPost(request('POST', { action: 'CLOSE' }, { origin: 'https://evil.example' }), gameCtx));
    expect(foreign.status).toBe(403);
  });
});

describe('signing up from the public page', () => {
  test('stores a waiting sign-up and answers with nothing but success', async () => {
    const code = await openAndGetCode();
    const reply = await signUp(code, { displayName: '  Ada   Lovelace ', email: ' Ada@Pilot.Test ' });
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(Object.keys(reply.body)).toEqual(['ok']);
    expect(await rows('SELECT display_name AS name, email, status FROM signups')).toEqual([{ name: 'Ada Lovelace', email: 'ada@pilot.test', status: 'PENDING' }]);
  });

  test('sends no email to the address a stranger typed', async () => {
    const code = await openAndGetCode();
    await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' });
    // Nothing is recorded or sent at sign-up; the private link exists only after a moderator accepts.
    expect(await count('SELECT COUNT(*) AS count FROM seats')).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM game_events WHERE event_type LIKE 'INVITE%'")).toBe(0);
  });

  test('answers the same for an email already on the list, so the page reveals nobody, and keeps one row', async () => {
    const code = await openAndGetCode();
    const first = await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' });
    const again = await signUp(code, { displayName: 'Someone Else', email: 'ADA@pilot.test' });
    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
    expect(await rows('SELECT display_name AS name FROM signups')).toEqual([{ name: 'Ada' }]);
  });

  test('a person already on the roster adds nothing and gets the same answer', async () => {
    const code = await openAndGetCode();
    await seedSeats(1, 'ada');
    const reply = await signUp(code, { displayName: 'Ada', email: 'ada-0@pilot.test' });
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(await count('SELECT COUNT(*) AS count FROM signups')).toBe(0);
  });

  test('a filled hidden field gets a success reply and stores nothing', async () => {
    const code = await openAndGetCode();
    const reply = await signUp(code, { displayName: 'Bot', email: 'bot@pilot.test', website: 'https://spam.example' });
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(await count('SELECT COUNT(*) AS count FROM signups')).toBe(0);
  });

  test('refuses a missing name, a bad email, and an address list', async () => {
    const code = await openAndGetCode();
    for (const body of [{ displayName: '', email: 'a@pilot.test' }, { displayName: 'Ada', email: 'nope' }, { displayName: 'Ada', email: 'a@pilot.test, b@pilot.test' }, { displayName: 'Ada', email: 'Ada <a@pilot.test>' }, null, 'text']) {
      expect((await signUp(code, body)).status).toBe(400);
    }
    expect(await count('SELECT COUNT(*) AS count FROM signups')).toBe(0);
  });

  test('an unknown or malformed link is a 404', async () => {
    await openAndGetCode();
    expect((await signUp('not-a-real-code', { displayName: 'Ada', email: 'a@pilot.test' })).status).toBe(404);
    expect((await signUp('x', { displayName: 'Ada', email: 'a@pilot.test' })).status).toBe(404);
    expect((await page('not-a-real-code')).body).toEqual({ ok: false, error: JOIN_COPY.invalidLink });
  });

  test('a post from another site is refused', async () => {
    const code = await openAndGetCode();
    const reply = await read(await joinSignupPost(request('POST', { displayName: 'Ada', email: 'a@pilot.test' }, { origin: 'https://evil.example' }), codeCtx(code)));
    expect(reply.status).toBe(403);
  });

  test('stops at the list limit, and declining frees room', async () => {
    const code = await openAndGetCode();
    await seedSignups(MAX_OPEN_SIGNUPS);
    expect(await signUp(code, { displayName: 'One Too Many', email: 'late@pilot.test' })).toMatchObject({ status: 409, body: { error: JOIN_COPY.listFull } });
    expect((await review('DECLINE', ['signup-0'])).status).toBe(200);
    expect((await signUp(code, { displayName: 'Just In Time', email: 'late@pilot.test' })).status).toBe(200);
  });

  test('slows a flood from one address', async () => {
    const code = await openAndGetCode();
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    let last: Reply | null = null;
    for (let attempt = 0; attempt < 61; attempt += 1) last = await signUp(code, { displayName: `Visitor ${attempt}`, email: `v${attempt}@pilot.test` }, headers);
    expect(last).toMatchObject({ status: 429 });
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await signUp(code, { displayName: 'Other', email: 'other@pilot.test' }, { 'x-forwarded-for': '203.0.113.10' })).status).toBe(200);
  });
});

describe('reviewing sign-ups', () => {
  test('declines and puts back, and a decision already made is a 409', async () => {
    const code = await openAndGetCode();
    await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' });
    await signUp(code, { displayName: 'Bo', email: 'bo@pilot.test' });
    const [ada] = await waiting();
    expect(await review('DECLINE', [ada.id])).toMatchObject({ status: 200, body: { changed: 1 } });
    expect((await view()).body.counts).toEqual({ pending: 1, accepted: 0, declined: 1 });
    expect(await review('DECLINE', [ada.id])).toMatchObject({ status: 409 });
    expect(await review('RESTORE', [ada.id])).toMatchObject({ status: 200, body: { changed: 1 } });
    expect((await view()).body.counts).toEqual({ pending: 2, accepted: 0, declined: 0 });
    expect(await review('RESTORE', [ada.id])).toMatchObject({ status: 409 });
    expect(await events('SIGNUPS_DECLINED')).toHaveLength(1);
    expect(await events('SIGNUPS_RESTORED')).toHaveLength(1);
  });

  test('only sign-ups of this game can be changed', async () => {
    await client.batch([
      { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2026-12-01','stranger','2026-01-01','2026-01-01')", args: [] },
      { sql: "INSERT INTO signups (id,game_id,display_name,email,status,created_at) VALUES ('foreign','other','Foreign','foreign@pilot.test','PENDING','2026-02-01')", args: [] },
    ], 'write');
    expect(await review('DECLINE', ['foreign'])).toMatchObject({ status: 409 });
    expect(await review('ACCEPT', ['foreign'])).toMatchObject({ status: 409 });
    expect(await count("SELECT COUNT(*) AS count FROM signups WHERE id = 'foreign' AND status = 'PENDING'")).toBe(1);
    expect(await seatCount()).toBe(0);
  });

  test('refuses a bad request', async () => {
    expect((await review('MAYBE', ['x'])).status).toBe(400);
    expect((await review('ACCEPT', [])).status).toBe(400);
    expect((await read(await reviewPost(request('POST', { decision: 'ACCEPT', signupIds: [7] }), gameCtx))).status).toBe(400);
    expect((await read(await reviewPost(request('POST', { decision: 'ACCEPT' }), gameCtx))).status).toBe(400);
  });

  test('accepting adds unclaimed seats with private links the moderator can email or download', async () => {
    await seedSignups(3);
    const accepted = await review('ACCEPT', ['signup-0', 'signup-1', 'signup-2']);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ added: 3, onRoster: 0, waiting: 0, playerCount: 3, message: '3 players added to the roster.' });
    expect(await rows("SELECT status, display_name AS name FROM seats ORDER BY display_name")).toEqual([
      { status: 'INVITED', name: 'Visitor 0' }, { status: 'INVITED', name: 'Visitor 1' }, { status: 'INVITED', name: 'Visitor 2' },
    ]);
    expect(await rows("SELECT status, (seat_id IS NOT NULL) AS seated FROM signups ORDER BY id")).toEqual([
      { status: 'ACCEPTED', seated: 1 }, { status: 'ACCEPTED', seated: 1 }, { status: 'ACCEPTED', seated: 1 },
    ]);
    // Only a hash of each private link is stored; the links come back once.
    expect(accepted.body.invites).toHaveLength(3);
    for (const invite of accepted.body.invites as Array<{ email: string; claimUrl: string; inviteCode: string }>) {
      expect(invite.claimUrl).toBe(`${ORIGIN}/claim/${encodeURIComponent(invite.inviteCode)}`);
      const seat = (await rows('SELECT claim_code_hash AS hash FROM seats WHERE email = ?', [invite.email]))[0];
      expect(seat.hash).toBe(await sha256(invite.inviteCode));
      expect(seat.hash).not.toBe(invite.inviteCode);
    }
    expect(await events('SIGNUPS_ACCEPTED')).toHaveLength(1);
  });

  test('an accepted player claims their seat with the link and a PIN, like any other player', async () => {
    await seedSignups(1);
    const accepted = await review('ACCEPT', ['signup-0']);
    const code = accepted.body.invites[0].inviteCode as string;
    const claimed = await read(await claimPost(request('POST', { pin: '123456' }), codeCtx(code)));
    expect(claimed).toMatchObject({ status: 200, body: { ok: true, seat: { displayName: 'Visitor 0' } } });
    expect((await rows("SELECT status FROM seats"))[0].status).toBe('CLAIMED');
  });

  test('the roster has no role counts until it reaches the minimum, then starts from the preset', async () => {
    await seedSignups(8);
    await review('ACCEPT', ['signup-0', 'signup-1', 'signup-2']);
    expect(Object.values(await composition()).reduce((sum, value) => sum + value, 0)).toBe(0);
    const more = await review('ACCEPT', ['signup-3', 'signup-4', 'signup-5', 'signup-6', 'signup-7']);
    expect(more.body).toMatchObject({ added: 5, playerCount: 8, resetToPreset: true });
    expect(await composition()).toEqual(defaultComposition(8));
  });

  test('accepting into a roster that already has players starts the roles from the preset for the new size', async () => {
    const imported = await read(await rosterPost(request('POST', { csv: ['display_name,email', ...Array.from({ length: 6 }, (_, index) => `Imported ${index},imported${index}@pilot.test`)].join('\n') }), gameCtx));
    expect(imported.status).toBe(200);
    await seedSignups(4);
    const accepted = await review('ACCEPT', ['signup-0', 'signup-1', 'signup-2', 'signup-3']);
    expect(accepted.body).toMatchObject({ added: 4, playerCount: 10, resetToPreset: true });
    expect(await composition()).toEqual(defaultComposition(10));
    expect(await seatCount()).toBe(10);
  });

  test('one accepted player keeps the moderator’s own role counts', async () => {
    await rosterPost(request('POST', { csv: ['display_name,email', ...Array.from({ length: 8 }, (_, index) => `Imported ${index},imported${index}@pilot.test`)].join('\n') }), gameCtx);
    await seedSignups(1);
    const accepted = await review('ACCEPT', ['signup-0']);
    expect(accepted.body).toMatchObject({ added: 1, playerCount: 9, resetToPreset: false });
    expect((await composition()).VILLAGER).toBe(defaultComposition(8).VILLAGER + 1);
  });

  test('someone already on the roster under the same email is marked accepted without a second seat', async () => {
    await seedSeats(7);
    await client.execute("INSERT INTO signups (id,game_id,display_name,email,status,created_at) VALUES ('dupe','game','Same Person','seat-3@pilot.test','PENDING','2026-02-01')");
    await seedSignups(1);
    const accepted = await review('ACCEPT', ['dupe', 'signup-0']);
    expect(accepted.body).toMatchObject({ added: 1, onRoster: 1, message: '1 player added to the roster. 1 was already on it.' });
    expect(await seatCount()).toBe(8);
    expect((await rows("SELECT status, seat_id AS seat FROM signups WHERE id = 'dupe'"))[0]).toEqual({ status: 'ACCEPTED', seat: 'seat-3' });
    const onlyDupe = await review('ACCEPT', ['dupe']);
    expect(onlyDupe.status).toBe(409);
  });

  test('a person already on the roster who is the only one chosen is marked accepted', async () => {
    await seedSeats(7);
    await client.execute("INSERT INTO signups (id,game_id,display_name,email,status,created_at) VALUES ('dupe','game','Same Person','seat-3@pilot.test','PENDING','2026-02-01')");
    const accepted = await review('ACCEPT', ['dupe']);
    expect(accepted.body).toMatchObject({ added: 0, onRoster: 1 });
    expect(await seatCount()).toBe(7);
    expect((await rows("SELECT status FROM signups WHERE id = 'dupe'"))[0].status).toBe('ACCEPTED');
  });

  test('people already on a full roster are still marked accepted, and nobody else is added', async () => {
    await seedSeats(MAX_PLAYERS);
    await client.execute("INSERT INTO signups (id,game_id,display_name,email,status,created_at) VALUES ('dupe','game','Same Person','seat-3@pilot.test','PENDING','2026-02-01')");
    await seedSignups(1);
    const accepted = await review('ACCEPT', ['dupe', 'signup-0']);
    expect(accepted).toMatchObject({ status: 200, body: { added: 0, onRoster: 1, waiting: 1 } });
    expect((await rows("SELECT status FROM signups WHERE id = 'dupe'"))[0].status).toBe('ACCEPTED');
    expect(await seatCount()).toBe(MAX_PLAYERS);
    expect((await review('ACCEPT', ['signup-0'])).body.error).toContain(`${MAX_PLAYERS}`);
  });

  test('marking people already on the roster never claims success when nothing changed', async () => {
    await seedSeats(7);
    await client.execute("INSERT INTO signups (id,game_id,display_name,email,status,created_at) VALUES ('dupe','game','Same Person','seat-3@pilot.test','PENDING','2026-02-01')");
    const [accepted, declined] = await Promise.all([review('ACCEPT', ['dupe']), review('DECLINE', ['dupe'])]);
    const status = String((await rows("SELECT status FROM signups WHERE id = 'dupe'"))[0].status);
    if (accepted.status === 200) expect(status).toBe('ACCEPTED');
    else expect(accepted.status).toBe(409);
    if (declined.status === 200) expect(status).toBe('DECLINED');
    expect([accepted.status, declined.status].filter((code) => code === 200)).toHaveLength(1);
  });

  test('leaves the newest waiting when the roster fills up', async () => {
    await seedSeats(MAX_PLAYERS - 2);
    await seedSignups(4);
    const accepted = await review('ACCEPT', ['signup-0', 'signup-1', 'signup-2', 'signup-3']);
    expect(accepted.body).toMatchObject({ added: 2, waiting: 2, playerCount: MAX_PLAYERS });
    expect((await waiting()).map((row) => row.id)).toEqual(['signup-2', 'signup-3']);
    expect(await seatCount()).toBe(MAX_PLAYERS);
    const full = await review('ACCEPT', ['signup-2']);
    expect(full).toMatchObject({ status: 409, body: { error: expect.stringContaining(`${MAX_PLAYERS}`) } });
  });

  test('accepting twice adds nobody twice', async () => {
    await seedSignups(2);
    expect((await review('ACCEPT', ['signup-0', 'signup-1'])).status).toBe(200);
    expect(await review('ACCEPT', ['signup-0', 'signup-1'])).toMatchObject({ status: 409 });
    expect(await seatCount()).toBe(2);
  });

  test('a sign-up declined at the same moment is either accepted with a seat or declined without one, never both', async () => {
    await seedSignups(3);
    const [accepted, declined] = await Promise.all([review('ACCEPT', ['signup-0', 'signup-1', 'signup-2']), review('DECLINE', ['signup-1'])]);
    expect([accepted.status, declined.status].every((status) => status === 200 || status === 409)).toBe(true);
    const states = await rows("SELECT id, status, seat_id AS seat FROM signups ORDER BY id");
    for (const state of states) expect(Boolean(state.seat)).toBe(state.status === 'ACCEPTED');
    expect(await seatCount()).toBe(states.filter((state) => state.status === 'ACCEPTED').length);
  });

  test('removing a player who signed up shows them as declined', async () => {
    await seedSignups(8);
    await review('ACCEPT', Array.from({ length: 8 }, (_, index) => `signup-${index}`));
    const seat = (await rows("SELECT seat_id AS seat FROM signups WHERE id = 'signup-2'"))[0].seat as string;
    const removed = await read(await seatDelete(request('DELETE'), { params: Promise.resolve({ gameId: 'game', seatId: seat }) }));
    expect(removed.status).toBe(200);
    expect((await rows("SELECT status, seat_id AS seat FROM signups WHERE id = 'signup-2'"))[0]).toEqual({ status: 'DECLINED', seat: null });
    // They can be put back and accepted again, which gives a fresh seat.
    expect((await review('RESTORE', ['signup-2'])).status).toBe(200);
    expect((await review('ACCEPT', ['signup-2'])).body).toMatchObject({ added: 1, playerCount: 8 });
  });

  test('a roster that is still short can have a player taken off it', async () => {
    await seedSignups(3);
    await review('ACCEPT', ['signup-0', 'signup-1', 'signup-2']);
    const seat = (await rows("SELECT seat_id AS seat FROM signups WHERE id = 'signup-0'"))[0].seat as string;
    expect((await read(await seatDelete(request('DELETE'), { params: Promise.resolve({ gameId: 'game', seatId: seat }) }))).status).toBe(200);
    expect(await seatCount()).toBe(2);
  });

  test('replacing the roster with a CSV puts accepted people back on the waiting list', async () => {
    await seedSignups(6);
    await review('ACCEPT', Array.from({ length: 6 }, (_, index) => `signup-${index}`));
    const imported = await read(await rosterPost(request('POST', { csv: ['display_name,email', ...Array.from({ length: 6 }, (_, index) => `Imported ${index},imported${index}@pilot.test`)].join('\n') }), gameCtx));
    expect(imported.status).toBe(200);
    expect((await view()).body.counts).toEqual({ pending: 6, accepted: 0, declined: 0 });
    expect(await seatCount()).toBe(6);
    expect(await count("SELECT COUNT(*) AS count FROM signups WHERE seat_id IS NOT NULL")).toBe(0);
  });

  test('after roles are randomized nothing can be accepted, and after release nothing can be reviewed', async () => {
    await seedSignups(2);
    await client.execute("UPDATE games SET status = 'ASSIGNMENT_PREVIEW' WHERE id = 'game'");
    expect((await review('ACCEPT', ['signup-0'])).status).toBe(409);
    expect((await review('DECLINE', ['signup-1'])).status).toBe(200);
    await client.execute("UPDATE games SET status = 'ACTIVE' WHERE id = 'game'");
    expect((await review('DECLINE', ['signup-0'])).status).toBe(409);
    expect(await seatCount()).toBe(0);
  });

  test('only the game’s moderators can review', async () => {
    await seedSignups(1);
    as('stranger');
    expect((await review('ACCEPT', ['signup-0'])).status).toBe(403);
    as(null);
    expect((await review('ACCEPT', ['signup-0'])).status).toBe(401);
    expect(await seatCount()).toBe(0);
  });

  test('the list shows names and emails to moderators only, and the console summary counts them', async () => {
    const code = await openAndGetCode();
    await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' });
    await signUp(code, { displayName: 'Bo', email: 'bo@pilot.test' });
    const listed = await view();
    expect(listed.body.signups.map((row: { displayName: string; email: string; status: string }) => [row.displayName, row.email, row.status])).toEqual([['Ada', 'ada@pilot.test', 'PENDING'], ['Bo', 'bo@pilot.test', 'PENDING']]);
    expect((await loadRosterView('game')).signups).toEqual({ state: 'OPEN', live: true, pending: 2, accepted: 0, applicationsOpen: false, pendingApplications: 0 });
  });
});

describe('a game can use an imported list, sign-ups, or both', () => {
  const csvOf = (prefix: string, total: number) => ['display_name,email', ...Array.from({ length: total }, (_, index) => `${prefix} ${index},${prefix.toLowerCase()}${index}@pilot.test`)].join('\n');
  const importList = async (prefix: string, total: number) => read(await rosterPost(request('POST', { csv: csvOf(prefix, total) }), gameCtx));
  const claim = async (code: string, pin: string) => read(await claimPost(request('POST', { pin }), codeCtx(code)));

  test('a list alone never involves sign-ups', async () => {
    const imported = await importList('Listed', 8);
    expect(imported).toMatchObject({ status: 200, body: { playerCount: 8 } });
    expect((await view()).body).toMatchObject({ state: 'NOT_OPEN', live: false, link: null, counts: { pending: 0, accepted: 0, declined: 0 } });
    expect((await loadRosterView('game')).signups).toEqual({ state: 'NOT_OPEN', live: false, pending: 0, accepted: 0, applicationsOpen: false, pendingApplications: 0 });
    expect(await composition()).toEqual(defaultComposition(8));
  });

  test('sign-ups alone can build a game, from the first visitor to released roles', async () => {
    const code = await openAndGetCode();
    for (let index = 0; index < 6; index += 1) expect((await signUp(code, { displayName: `Visitor ${index}`, email: `visitor${index}@pilot.test` })).status).toBe(200);
    const accepted = await review('ACCEPT', (await waiting()).map((row) => row.id));
    expect(accepted.body).toMatchObject({ added: 6, playerCount: 6, resetToPreset: true });
    expect(await composition()).toEqual(defaultComposition(6));
    for (const [index, invite] of (accepted.body.invites as Array<{ inviteCode: string }>).entries()) expect((await claim(invite.inviteCode, `55000${index}`)).status).toBe(200);
    const preview = await read(await assignmentsPost(request('POST', { action: 'PREVIEW' }), gameCtx));
    expect(preview.status).toBe(200);
    const batchId = String((await rows("SELECT id FROM assignment_batches WHERE game_id = 'game'"))[0].id);
    expect((await read(await assignmentsPost(request('POST', { action: 'RELEASE', batchId }), gameCtx))).status).toBe(200);
    expect((await rows("SELECT status FROM games WHERE id = 'game'"))[0].status).toBe('ACTIVE');
    expect(await count("SELECT COUNT(*) AS count FROM role_assignments WHERE game_id = 'game'")).toBe(6);
  });

  test('a list and sign-ups together: import first, then accept people on top, and every invite works', async () => {
    const imported = await importList('Listed', 6);
    const code = await openAndGetCode();
    await signUp(code, { displayName: 'Visitor A', email: 'a@pilot.test' });
    await signUp(code, { displayName: 'Visitor B', email: 'b@pilot.test' });
    const accepted = await review('ACCEPT', (await waiting()).map((row) => row.id));
    expect(accepted.body).toMatchObject({ added: 2, playerCount: 8, resetToPreset: true });
    expect(await seatCount()).toBe(8);
    expect(await composition()).toEqual(defaultComposition(8));
    expect(await count("SELECT COUNT(*) AS count FROM seats WHERE status = 'INVITED'")).toBe(8);
    expect((await view()).body.counts).toEqual({ pending: 0, accepted: 2, declined: 0 });
    // Players from the list and players from sign-ups claim the same way.
    const fromList = imported.body.invites[0].inviteCode as string;
    const fromSignup = accepted.body.invites[0].inviteCode as string;
    expect((await claim(fromList, '111111')).status).toBe(200);
    expect((await claim(fromSignup, '222222')).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS count FROM seats WHERE status = 'CLAIMED'")).toBe(2);
  });

  test('importing after sign-ups were accepted replaces the roster, and those people can be accepted again on top', async () => {
    const code = await openAndGetCode();
    for (let index = 0; index < 3; index += 1) await signUp(code, { displayName: `Visitor ${index}`, email: `visitor${index}@pilot.test` });
    await review('ACCEPT', (await waiting()).map((row) => row.id));
    expect(await seatCount()).toBe(3);

    // A list sent with no mode, or as REPLACE, starts the roster over, as it always has.
    expect((await importList('Listed', 6)).status).toBe(200);
    expect(await seatCount()).toBe(6);
    expect((await view()).body.counts).toEqual({ pending: 3, accepted: 0, declined: 0 });
    // Their old links are dead, and the list is exactly what was imported.
    expect(await count("SELECT COUNT(*) AS count FROM seats WHERE email LIKE 'visitor%' AND status != 'REMOVED'")).toBe(0);

    const again = await review('ACCEPT', (await waiting()).map((row) => row.id));
    expect(again.body).toMatchObject({ added: 3, playerCount: 9, resetToPreset: true });
    expect(await composition()).toEqual(defaultComposition(9));
  });

  describe('importing a list after sign-ups have started', () => {
    const addList = async (prefix: string, total: number) => read(await rosterPost(request('POST', { csv: csvOf(prefix, total), mode: 'ADD' }), gameCtx));
    const signUpAndAccept = async (total: number) => {
      const code = await openAndGetCode();
      for (let index = 0; index < total; index += 1) await signUp(code, { displayName: `Visitor ${index}`, email: `visitor${index}@pilot.test` });
      return review('ACCEPT', (await waiting()).map((row) => row.id));
    };

    test('adding a list keeps everyone accepted from sign-ups, with their seats and links', async () => {
      const accepted = await signUpAndAccept(2);
      const before = await rows("SELECT id, claim_code_hash AS hash FROM seats WHERE email LIKE 'visitor%' ORDER BY email");
      const added = await addList('Listed', 6);
      expect(added).toMatchObject({ status: 200, body: { ok: true, added: 6, skipped: 0, playerCount: 8, resetToPreset: true } });
      expect(added.body.invites).toHaveLength(6);
      // The file to download holds only the people just added; the others already have their links.
      expect(added.body.inviteCsv).toContain('listed0@pilot.test');
      expect(added.body.inviteCsv).not.toContain('visitor0@pilot.test');
      expect(await seatCount()).toBe(8);
      expect(await rows("SELECT id, claim_code_hash AS hash FROM seats WHERE email LIKE 'visitor%' ORDER BY email")).toEqual(before);
      expect((await view()).body.counts).toEqual({ pending: 0, accepted: 2, declined: 0 });
      expect(await composition()).toEqual(defaultComposition(8));
      expect(await count("SELECT COUNT(*) AS count FROM seats WHERE status = 'INVITED'")).toBe(8);
      // Both groups claim the same way.
      expect((await claim(accepted.body.invites[0].inviteCode, '111111')).status).toBe(200);
      expect((await claim(added.body.invites[0].inviteCode, '222222')).status).toBe(200);
      expect(await events('ROSTER_APPENDED')).toHaveLength(1);
    });

    test('adding to an empty roster is the same as the first import, and a short list can be topped up', async () => {
      const first = await addList('Listed', 3);
      expect(first).toMatchObject({ status: 200, body: { added: 3, playerCount: 3 } });
      // Below the minimum there are no role counts yet.
      expect(Object.values(await composition()).reduce((sum, value) => sum + value, 0)).toBe(0);
      const second = await addList('More', 3);
      expect(second).toMatchObject({ status: 200, body: { added: 3, playerCount: 6, resetToPreset: true } });
      expect(await composition()).toEqual(defaultComposition(6));
    });

    test('adding one person keeps the moderator’s own role counts', async () => {
      await importList('Listed', 8);
      const added = await addList('One', 1);
      expect(added).toMatchObject({ status: 200, body: { added: 1, playerCount: 9, resetToPreset: false } });
      expect((await composition()).VILLAGER).toBe(defaultComposition(8).VILLAGER + 1);
    });

    test('someone already on the roster is skipped, and a list of only those people changes nothing', async () => {
      await signUpAndAccept(2);
      const overlap = ['display_name,email', 'Visitor Zero again,visitor0@pilot.test', 'Fresh One,fresh1@pilot.test', 'Fresh Two,fresh2@pilot.test'].join('\n');
      const added = await read(await rosterPost(request('POST', { csv: overlap, mode: 'ADD' }), gameCtx));
      expect(added).toMatchObject({ status: 200, body: { added: 2, skipped: 1, playerCount: 4 } });
      expect(await count("SELECT COUNT(*) AS count FROM seats WHERE email = 'visitor0@pilot.test'")).toBe(1);

      const revision = (await rows("SELECT setup_revision AS revision FROM games WHERE id = 'game'"))[0].revision;
      const nothing = await read(await rosterPost(request('POST', { csv: overlap, mode: 'ADD' }), gameCtx));
      expect(nothing.status).toBe(409);
      expect(nothing.body.error).toMatch(/already on the roster/u);
      expect((await rows("SELECT setup_revision AS revision FROM games WHERE id = 'game'"))[0].revision).toBe(revision);
      expect(await seatCount()).toBe(4);
    });

    test('a person who signed up and is also on the list gets one seat, and their sign-up shows as accepted', async () => {
      const code = await openAndGetCode();
      await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' });
      await signUp(code, { displayName: 'Bo', email: 'bo@pilot.test' });
      const listed = await read(await rosterPost(request('POST', { csv: ['display_name,email', 'Ada Lovelace,ada@pilot.test', 'Cy,cy@pilot.test'].join('\n'), mode: 'ADD' }), gameCtx));
      expect(listed.body).toMatchObject({ added: 2, playerCount: 2 });
      expect(await count("SELECT COUNT(*) AS count FROM seats WHERE email = 'ada@pilot.test'")).toBe(1);
      const ada = (await rows("SELECT status, seat_id AS seat FROM signups WHERE email = 'ada@pilot.test'"))[0];
      expect(ada.status).toBe('ACCEPTED');
      expect(ada.seat).toBe((await rows("SELECT id FROM seats WHERE email = 'ada@pilot.test'"))[0].id);
      // Bo is still waiting, and a declined sign-up on the list is also on the roster now.
      expect((await view()).body.counts).toEqual({ pending: 1, accepted: 1, declined: 0 });
    });

    test('a declined sign-up on the list is on the roster and shows as accepted', async () => {
      const code = await openAndGetCode();
      await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' });
      await review('DECLINE', (await waiting()).map((row) => row.id));
      await addList('Listed', 1);
      const listed = await read(await rosterPost(request('POST', { csv: ['display_name,email', 'Ada,ada@pilot.test'].join('\n'), mode: 'ADD' }), gameCtx));
      expect(listed.status).toBe(200);
      expect((await view()).body.counts).toEqual({ pending: 0, accepted: 1, declined: 0 });
    });

    test('the roster can never go over the limit, and a refused list changes nothing', async () => {
      await seedSeats(MAX_PLAYERS - 1);
      const refused = await addList('Extra', 3);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatch(/at most 80/u);
      expect(refused.body.error).toMatch(/room for 1 more/u);
      expect(await seatCount()).toBe(MAX_PLAYERS - 1);
      expect(await addList('Extra', 1)).toMatchObject({ status: 200, body: { playerCount: MAX_PLAYERS } });
    });

    test('a bad list is refused with the reasons, and a list over the limit is too', async () => {
      const empty = await read(await rosterPost(request('POST', { csv: '', mode: 'ADD' }), gameCtx));
      expect(empty.status).toBe(400);
      const headerOnly = await read(await rosterPost(request('POST', { csv: 'display_name,email', mode: 'ADD' }), gameCtx));
      expect(headerOnly.status).toBe(400);
      expect(headerOnly.body.errors.join(' ')).toMatch(/between 1 and 80/u);
      const badEmail = await read(await rosterPost(request('POST', { csv: 'display_name,email\nNo Email,not-an-email', mode: 'ADD' }), gameCtx));
      expect(badEmail.status).toBe(400);
      expect(await seatCount()).toBe(0);
    });

    test('an unknown mode is refused, and replacing still needs a playable roster', async () => {
      const unknown = await read(await rosterPost(request('POST', { csv: csvOf('Listed', 6), mode: 'MERGE' }), gameCtx));
      expect(unknown.status).toBe(400);
      expect(await seatCount()).toBe(0);
      const short = await read(await rosterPost(request('POST', { csv: csvOf('Listed', 2), mode: 'REPLACE' }), gameCtx));
      expect(short.status).toBe(400);
      expect(short.body.errors.join(' ')).toMatch(/between 6 and 80/u);
      expect((await rosterPost(request('POST', { csv: csvOf('Listed', 6), mode: 'REPLACE' }), gameCtx)).status).toBe(200);
    });

    test('replacing still starts the roster over and sends accepted people back to waiting', async () => {
      await signUpAndAccept(3);
      const replaced = await read(await rosterPost(request('POST', { csv: csvOf('Listed', 6), mode: 'REPLACE' }), gameCtx));
      expect(replaced).toMatchObject({ status: 200, body: { playerCount: 6 } });
      expect(await seatCount()).toBe(6);
      expect((await view()).body.counts).toEqual({ pending: 3, accepted: 0, declined: 0 });
    });

    test('only a moderator of the game can add, only before roles are randomized, and a cross-origin post is refused', async () => {
      await importList('Listed', 6);
      as('stranger');
      expect((await addList('Extra', 1)).status).toBe(403);
      as(null);
      expect((await addList('Extra', 1)).status).toBe(401);
      as('owner');
      expect((await read(await rosterPost(request('POST', { csv: csvOf('Extra', 1), mode: 'ADD' }, { origin: 'https://evil.test' }), gameCtx))).status).toBe(403);
      await client.execute("UPDATE games SET status = 'ASSIGNMENT_PREVIEW' WHERE id = 'game'");
      expect((await addList('Extra', 1)).status).toBe(409);
      await client.execute("UPDATE games SET status = 'ACTIVE' WHERE id = 'game'");
      expect((await addList('Extra', 1)).status).toBe(409);
      expect(await seatCount()).toBe(6);
    });

    test('a roster edit at the same moment leaves one winner and never a half-added list', async () => {
      await importList('Listed', 8);
      const [first, second] = await Promise.all([addList('Left', 2), addList('Right', 2)]);
      const statuses = [first.status, second.status].sort();
      // Each list is whole or absent, and the roster matches the count the winners report.
      const total = await seatCount();
      expect([8, 10, 12]).toContain(total);
      expect(total).toBe(8 + 2 * statuses.filter((status) => status === 200).length);
      expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
      expect(Object.values(await composition()).reduce((sum, value) => sum + value, 0)).toBe(total);
    });

    test('two single players added at the same moment never leave seats the role counts do not cover', async () => {
      await importList('Listed', 8);
      const add = async (email: string) => read(await seatsPost(request('POST', { displayName: email, email }), gameCtx));
      const [first, second] = await Promise.all([add('first@pilot.test'), add('second@pilot.test')]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      expect(await seatCount()).toBe(9);
      expect(Object.values(await composition()).reduce((sum, value) => sum + value, 0)).toBe(9);
      expect(await events('SEAT_ADDED')).toHaveLength(1);
    });

    test('adding and accepting at the same moment never double-seats a person', async () => {
      const code = await openAndGetCode();
      await signUp(code, { displayName: 'Ada', email: 'ada@pilot.test' });
      await importList('Listed', 6);
      const [accepted, added] = await Promise.all([
        review('ACCEPT', (await waiting()).map((row) => row.id)),
        read(await rosterPost(request('POST', { csv: ['display_name,email', 'Ada,ada@pilot.test', 'New,new@pilot.test'].join('\n'), mode: 'ADD' }), gameCtx)),
      ]);
      expect([accepted.status, added.status].every((status) => status === 200 || status === 409)).toBe(true);
      expect(await count("SELECT COUNT(*) AS count FROM seats WHERE email = 'ada@pilot.test' AND status != 'REMOVED'")).toBeLessThanOrEqual(1);
      const total = await seatCount();
      expect(Object.values(await composition()).reduce((sum, value) => sum + value, 0)).toBe(total);
    });
  });

  test('someone on the imported list who also signs up is not given a second seat', async () => {
    await importList('Listed', 6);
    const code = await openAndGetCode();
    // The form quietly ignores an email that is already on the roster.
    expect((await signUp(code, { displayName: 'Listed 2 again', email: 'listed2@pilot.test' })).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS count FROM signups')).toBe(0);
    expect(await seatCount()).toBe(6);
  });
});

describe('sign-ups and the roster agree however people reach it', () => {
  const csvOf = (people: Array<[string, string]>) => ['display_name,email', ...people.map(([name, email]) => `${name},${email}`)].join('\n');
  const importList = async (people: Array<[string, string]>, mode?: string) => read(await rosterPost(request('POST', { csv: csvOf(people), ...(mode ? { mode } : {}) }), gameCtx));
  const six: Array<[string, string]> = Array.from({ length: 6 }, (_, index) => [`Listed ${index}`, `listed${index}@pilot.test`]);

  test('a list that replaces the roster marks waiting and declined sign-ups on it as accepted, with their seats', async () => {
    await seedSignups(2);
    await review('DECLINE', ['signup-1']);
    const replaced = await importList([...six, ['Visitor 0', 'visitor-0@pilot.test'], ['Visitor 1', 'visitor-1@pilot.test']]);
    expect(replaced.status).toBe(200);
    expect((await view()).body.counts).toEqual({ pending: 0, accepted: 2, declined: 0 });
    const seats = await rows("SELECT s.email AS seatEmail, g.email AS signupEmail FROM signups g JOIN seats s ON s.id = g.seat_id WHERE s.status != 'REMOVED'");
    expect(seats).toHaveLength(2);
    for (const row of seats) expect(row.seatEmail).toBe(row.signupEmail);
  });

  test('a person accepted earlier who is also on the replacing list stays accepted with their new seat; one who is not goes back to waiting', async () => {
    await seedSignups(2);
    await review('ACCEPT', ['signup-0', 'signup-1']);
    const replaced = await importList([...six, ['Visitor 0', 'visitor-0@pilot.test']]);
    expect(replaced.status).toBe(200);
    expect((await view()).body.counts).toEqual({ pending: 1, accepted: 1, declined: 0 });
    const kept = (await rows("SELECT g.seat_id AS seatId, s.status AS seatStatus FROM signups g JOIN seats s ON s.id = g.seat_id WHERE g.email = 'visitor-0@pilot.test'"))[0];
    expect(kept.seatStatus).toBe('INVITED');
    expect(await seatCount()).toBe(7);
  });

  test('adding one player by hand who had signed up shows them as accepted', async () => {
    await seedSeats(6);
    await seedSignups(1);
    const added = await read(await seatsPost(request('POST', { displayName: 'Visitor Zero', email: 'visitor-0@pilot.test' }), gameCtx));
    expect(added.status).toBe(200);
    expect((await view()).body.counts).toEqual({ pending: 0, accepted: 1, declined: 0 });
    const linked = (await rows("SELECT seat_id AS seatId FROM signups WHERE email = 'visitor-0@pilot.test'"))[0];
    expect(linked.seatId).toBe(added.body.seat.id);
  });
});

describe('restoring a backup', () => {
  async function restoreFrom(backupId: string) {
    const stored = (await rows('SELECT id, game_id AS gameId, schema_version AS schemaVersion, checksum, payload_json AS payloadJson FROM backup_exports WHERE id = ?', [backupId]))[0] as { id: string; gameId: string; schemaVersion: number; checksum: string; payloadJson: string };
    return restoreGameBackup('game', { id: stored.id, gameId: stored.gameId, schemaVersion: Number(stored.schemaVersion), checksum: stored.checksum, payloadJson: stored.payloadJson }, 'owner', ORIGIN);
  }

  test('people accepted after the backup go back to waiting and can be accepted again; people whose seat comes back stay accepted', async () => {
    await seedSeats(6);
    await seedSignups(4);
    // Visitor 0 is accepted before the backup, Visitor 1 after; Visitor 2 is declined; Visitor 3 is still waiting.
    await review('ACCEPT', ['signup-0']);
    await review('DECLINE', ['signup-2']);
    const backup = await createBackupRecord('game', 'owner');
    await review('ACCEPT', ['signup-1']);
    expect(await seatCount()).toBe(8);

    await restoreFrom(backup.backupId);
    expect(await seatCount()).toBe(7);
    expect((await view()).body.counts).toEqual({ pending: 2, accepted: 1, declined: 1 });
    const status = async (id: string) => (await rows('SELECT status, seat_id AS seatId FROM signups WHERE id = ?', [id]))[0];
    expect(await status('signup-0')).toMatchObject({ status: 'ACCEPTED' });
    expect(await status('signup-1')).toMatchObject({ status: 'PENDING', seatId: null });
    // Whoever is accepted points at a seat that is really on the roster.
    const onRoster = (await rows("SELECT s.status AS seatStatus FROM signups g JOIN seats s ON s.id = g.seat_id WHERE g.id = 'signup-0'"))[0];
    expect(onRoster.seatStatus).toBe('INVITED');

    // The person who was dropped can be accepted again, instead of being stuck.
    const again = await review('ACCEPT', ['signup-1']);
    expect(again).toMatchObject({ status: 200, body: { added: 1 } });
    expect(await seatCount()).toBe(8);
  });
});
