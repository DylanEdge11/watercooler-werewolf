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
import { POST as rosterPost } from '../app/api/games/[gameId]/roster/route';
import { DELETE as seatDelete } from '../app/api/games/[gameId]/seats/[seatId]/route';
import { GET as joinGet } from '../app/api/join/[code]/route';
import { POST as joinSignupPost } from '../app/api/join/[code]/signup/route';
import { POST as claimPost } from '../app/api/seats/claim/[code]/route';
import { sha256 } from './auth/crypto';
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
