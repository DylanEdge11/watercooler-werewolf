import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  moderator: null as { id: string; email: string } | null,
  signedIn: [] as string[],
  mail: [] as Array<{ to: string; subject: string; text: string }>,
  mailStatus: 'SENT' as 'SENT' | 'UNAVAILABLE' | 'SKIPPED' | 'FAILED',
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({
  getCurrentModerator: async () => shared.moderator,
  createModeratorSession: async (id: string) => { shared.signedIn.push(id); },
}));
// Hand the limiter the test database directly. Its own lazy import of the database module can lose a race
// between two simultaneous requests under vitest's mocks; production imports it once and caches it.
vi.mock('./http/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('./http/rate-limit')>();
  return { ...original, enforceRateLimit: (key: string, limit: number, windowMs: number) => original.enforceRateLimit(key, limit, windowMs, shared.db as LibsqlDatabase) };
});
vi.mock('./email/send-one', () => ({
  sendOneEmail: async (to: string, message: { subject: string; text: string }) => {
    shared.mail.push({ to, ...message });
    return shared.mailStatus === 'FAILED' ? { status: 'FAILED', reason: 'The email server could not be reached.' } : { status: shared.mailStatus };
  },
}));

import { GET as applicationsGet, POST as applicationsPost } from '../app/api/games/[gameId]/applications/route';
import { POST as decisionPost } from '../app/api/games/[gameId]/applications/[applicationId]/route';
import { GET as joinGet } from '../app/api/join/[code]/route';
import { POST as applyPost } from '../app/api/join/[code]/apply/route';
import { GET as setupGet, POST as setupPost } from '../app/api/moderators/join/[code]/route';
import { POST as signupsPost } from '../app/api/games/[gameId]/signups/route';
import { authenticateModerator } from './auth/moderators';
import { sha256 } from './auth/crypto';
import { JOIN_COPY, MODERATOR_SETUP_COPY } from './game/join-copy';
import { MAX_OPEN_APPLICATIONS } from './game/moderator-applications';
import { loadRosterView } from './game/setup-view';

let client: Client;
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'a-long-enough-password';

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

const gameCtx = (gameId = 'game') => ({ params: Promise.resolve({ gameId }) });
const codeCtx = (code: string) => ({ params: Promise.resolve({ code }) });
const control = async (action: string, gameId = 'game') => read(await applicationsPost(request('POST', { action }), gameCtx(gameId)));
const list = async () => read(await applicationsGet(request('GET'), gameCtx()));
const decide = async (applicationId: string, decision: string, gameId = 'game') => read(await decisionPost(request('POST', { decision }), { params: Promise.resolve({ gameId, applicationId }) }));
const apply = async (code: string, body: unknown, headers: Record<string, string> = {}) => read(await applyPost(request('POST', body, headers), codeCtx(code)));
const setupLookup = async (code: string) => read(await setupGet(request('GET'), codeCtx(code)));
const redeem = async (code: string, password: unknown = PASSWORD) => read(await setupPost(request('POST', { password }), codeCtx(code)));

async function rows(sql: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  return (await client.execute({ sql, args })).rows as unknown as Array<Record<string, unknown>>;
}
const count = async (sql: string, args: Array<string | number> = []) => Number((await rows(sql, args))[0]?.count);
const events = async (type: string) => rows('SELECT actor_moderator_id AS actor, payload_json AS payload FROM game_events WHERE event_type = ?', [type]);

async function openAndGetCode(): Promise<string> {
  const opened = await control('OPEN');
  expect(opened.status).toBe(200);
  return String(opened.body.link).split('/join/')[1];
}

async function applyAndFind(code: string, name: string, email: string, note?: string): Promise<string> {
  expect((await apply(code, { displayName: name, email, note })).status).toBe(200);
  return String((await rows('SELECT id FROM moderator_applications WHERE email = ?', [email]))[0].id);
}

async function approveForLink(code: string, name = 'Newcomer', email = 'newcomer@pilot.test'): Promise<{ id: string; setupUrl: string; setupCode: string }> {
  const id = await applyAndFind(code, name, email);
  const approved = await decide(id, 'APPROVE');
  expect(approved).toMatchObject({ status: 200, body: { outcome: 'LINK' } });
  const setupUrl = String(approved.body.setupUrl);
  return { id, setupUrl, setupCode: decodeURIComponent(setupUrl.split('/moderator/join/')[1]) };
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.signedIn = [];
  shared.mail = [];
  shared.mailStatus = 'SENT';
  const account = (id: string) => ({ sql: `INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('${id}','${id}@pilot.test','x','[]','2026-01-01','2026-01-01')`, args: [] });
  await client.batch([
    account('owner'), account('cora'), account('stranger'),
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Office Campaign','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2026-12-01','owner','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other Game','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2026-12-01','stranger','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','owner','OWNER','2026-01-01'), ('game','cora','CO_MODERATOR','2026-01-01'), ('other','stranger','OWNER','2026-01-01')", args: [] },
  ], 'write');
  as('owner');
});

afterEach(() => {
  shared.db = null;
  shared.moderator = null;
  client.close();
});

describe('taking applications', () => {
  test('the owner opens applications on the same public link, and the page offers the form and nothing about applicants', async () => {
    const opened = await control('OPEN');
    expect(opened).toMatchObject({ status: 200, body: { ok: true, open: true, applications: [] } });
    expect(opened.body.link).toMatch(/^http:\/\/localhost:3000\/join\/[A-Za-z0-9_-]{8,}$/u);
    expect(await events('MODERATOR_APPLICATIONS_OPENED')).toHaveLength(1);
    const code = String(opened.body.link).split('/join/')[1];
    const shown = await read(await joinGet(request('GET'), codeCtx(code)));
    expect(shown.body.page).toMatchObject({ gameName: 'Office Campaign', applications: true, signups: 'NOT_OPEN' });
  });

  test('opening again changes nothing, and closing stops new applications', async () => {
    const code = await openAndGetCode();
    await control('OPEN');
    expect(await events('MODERATOR_APPLICATIONS_OPENED')).toHaveLength(1);
    expect(await control('CLOSE')).toMatchObject({ status: 200, body: { open: false } });
    expect(await events('MODERATOR_APPLICATIONS_CLOSED')).toHaveLength(1);
    expect(await apply(code, { displayName: 'Late', email: 'late@pilot.test' })).toMatchObject({ status: 409, body: { error: JOIN_COPY.applicationsClosed('Office Campaign') } });
    expect(await count('SELECT COUNT(*) AS count FROM moderator_applications')).toBe(0);
  });

  test('player sign-ups and applications share one link', async () => {
    const signups = await read(await signupsPost(request('POST', { action: 'OPEN' }), gameCtx()));
    const applications = await control('OPEN');
    expect(applications.body.link).toBe(signups.body.link);
  });

  test('only the owner can take or see applications', async () => {
    as('cora');
    expect(await control('OPEN')).toMatchObject({ status: 403, body: { error: expect.stringContaining('Only the game owner') } });
    expect((await list()).status).toBe(403);
    as('stranger');
    expect((await control('OPEN')).status).toBe(403);
    as(null);
    expect((await control('OPEN')).status).toBe(401);
    expect((await list()).status).toBe(401);
  });

  test('a cross-origin post is refused, and so is an unknown action', async () => {
    expect((await read(await applicationsPost(request('POST', { action: 'OPEN' }, { origin: 'https://evil.example' }), gameCtx()))).status).toBe(403);
    expect((await control('EXPLODE')).status).toBe(400);
  });

  test('a game that is over takes no applications', async () => {
    await client.execute("UPDATE games SET status = 'COMPLETED' WHERE id = 'game'");
    expect(await control('OPEN')).toMatchObject({ status: 409 });
  });

  test('applications can be taken in a running game', async () => {
    await client.execute("UPDATE games SET status = 'ACTIVE' WHERE id = 'game'");
    expect((await control('OPEN')).status).toBe(200);
  });
});

describe('applying from the public page', () => {
  test('stores a waiting application with its note and answers with nothing but success', async () => {
    const code = await openAndGetCode();
    const reply = await apply(code, { displayName: '  Nia   Newcomer ', email: ' Nia@Pilot.Test ', note: '  I ran the Q3 game.  ' });
    expect(reply).toMatchObject({ status: 200, body: { ok: true } });
    expect(Object.keys(reply.body)).toEqual(['ok']);
    expect(await rows('SELECT display_name AS name, email, note, status FROM moderator_applications')).toEqual([{ name: 'Nia Newcomer', email: 'nia@pilot.test', note: 'I ran the Q3 game.', status: 'PENDING' }]);
  });

  test('sends nothing to the address a stranger typed', async () => {
    const code = await openAndGetCode();
    await apply(code, { displayName: 'Nia', email: 'nia@pilot.test' });
    expect(shared.mail).toEqual([]);
  });

  test('answers the same for an email that already applied, and for someone who already moderates this game', async () => {
    const code = await openAndGetCode();
    const first = await apply(code, { displayName: 'Nia', email: 'nia@pilot.test' });
    const again = await apply(code, { displayName: 'Other Name', email: 'NIA@pilot.test' });
    const member = await apply(code, { displayName: 'Cora', email: 'cora@pilot.test' });
    expect(again).toMatchObject({ status: first.status, body: first.body });
    expect(member).toMatchObject({ status: first.status, body: first.body });
    expect(await rows('SELECT email FROM moderator_applications')).toEqual([{ email: 'nia@pilot.test' }]);
  });

  test('a filled hidden field gets a success reply and stores nothing', async () => {
    const code = await openAndGetCode();
    expect(await apply(code, { displayName: 'Bot', email: 'bot@pilot.test', website: 'https://spam.example' })).toMatchObject({ status: 200, body: { ok: true } });
    expect(await count('SELECT COUNT(*) AS count FROM moderator_applications')).toBe(0);
  });

  test('refuses a missing name, a bad email, an address list, and a long note', async () => {
    const code = await openAndGetCode();
    for (const body of [{ displayName: '', email: 'a@pilot.test' }, { displayName: 'A', email: 'nope' }, { displayName: 'A', email: 'a@pilot.test;b@pilot.test' }, { displayName: 'A', email: 'a@pilot.test', note: 'x'.repeat(501) }, null]) {
      expect((await apply(code, body)).status).toBe(400);
    }
    expect(await count('SELECT COUNT(*) AS count FROM moderator_applications')).toBe(0);
  });

  test('an unknown link is a 404, and a post from another site is a 403', async () => {
    const code = await openAndGetCode();
    expect((await apply('not-a-real-code', { displayName: 'A', email: 'a@pilot.test' })).status).toBe(404);
    expect((await read(await applyPost(request('POST', { displayName: 'A', email: 'a@pilot.test' }, { origin: 'https://evil.example' }), codeCtx(code)))).status).toBe(403);
  });

  test('stops at the list limit, and declining frees room', async () => {
    const code = await openAndGetCode();
    await client.batch(
      Array.from({ length: MAX_OPEN_APPLICATIONS }, (_, index) => ({
        sql: "INSERT INTO moderator_applications (id,game_id,display_name,email,status,created_at) VALUES (?, 'game', ?, ?, 'PENDING', '2026-02-01')",
        args: [`app-${index}`, `Applicant ${index}`, `applicant-${index}@pilot.test`],
      })),
      'write',
    );
    expect(await apply(code, { displayName: 'One Too Many', email: 'late@pilot.test' })).toMatchObject({ status: 409, body: { error: JOIN_COPY.applicationsFull } });
    expect((await decide('app-0', 'DECLINE')).status).toBe(200);
    expect((await apply(code, { displayName: 'Just In Time', email: 'late@pilot.test' })).status).toBe(200);
  });

  test('slows a flood from one address', async () => {
    const code = await openAndGetCode();
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    let last: Reply | null = null;
    for (let attempt = 0; attempt < 11; attempt += 1) last = await apply(code, { displayName: `A${attempt}`, email: `a${attempt}@pilot.test` }, headers);
    expect(last).toMatchObject({ status: 429 });
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('the owner sees the applicant’s name, email, and note; the console summary counts them', async () => {
    const code = await openAndGetCode();
    await apply(code, { displayName: 'Nia', email: 'nia@pilot.test', note: 'Hello' });
    const listed = await list();
    expect(listed.body.applications).toEqual([expect.objectContaining({ displayName: 'Nia', email: 'nia@pilot.test', note: 'Hello', status: 'PENDING', joined: false })]);
    expect((await loadRosterView('game')).signups).toMatchObject({ applicationsOpen: true, pendingApplications: 1 });
  });
});

describe('approving an applicant who has no account', () => {
  test('issues a one-time setup link, emails it, and keeps only its hash', async () => {
    const code = await openAndGetCode();
    const { id, setupUrl, setupCode } = await approveForLink(code);
    expect(setupUrl).toMatch(/^http:\/\/localhost:3000\/moderator\/join\/[A-Za-z0-9_-]{8,}$/u);
    expect(shared.mail).toHaveLength(1);
    expect(shared.mail[0]).toMatchObject({ to: 'newcomer@pilot.test', subject: 'You’re approved to moderate Office Campaign' });
    expect(shared.mail[0].text).toContain(setupUrl);
    const stored = (await rows('SELECT status, setup_code_hash AS hash, moderator_id AS moderator FROM moderator_applications WHERE id = ?', [id]))[0];
    expect(stored).toEqual({ status: 'APPROVED', hash: await sha256(setupCode), moderator: null });
    expect(JSON.stringify(await rows('SELECT * FROM moderator_applications'))).not.toContain(setupCode);
    expect(await events('MODERATOR_APPLICATION_APPROVED')).toHaveLength(1);
    // The list never carries the link or its hash.
    expect(JSON.stringify((await list()).body)).not.toContain(setupCode);
    expect((await list()).body.applications[0]).toMatchObject({ status: 'APPROVED', joined: false, linkExpired: false });
  });

  test('still returns the link when the site cannot send email, so the owner can pass it on', async () => {
    shared.mailStatus = 'UNAVAILABLE';
    const code = await openAndGetCode();
    const id = await applyAndFind(code, 'Newcomer', 'newcomer@pilot.test');
    const approved = await decide(id, 'APPROVE');
    expect(approved.body).toMatchObject({ outcome: 'LINK', email: 'UNAVAILABLE' });
    expect(approved.body.setupUrl).toContain('/moderator/join/');
  });

  test('reports a failed send without losing the approval', async () => {
    shared.mailStatus = 'FAILED';
    const code = await openAndGetCode();
    const id = await applyAndFind(code, 'Newcomer', 'newcomer@pilot.test');
    const approved = await decide(id, 'APPROVE');
    expect(approved.body).toMatchObject({ outcome: 'LINK', email: 'FAILED', emailReason: 'The email server could not be reached.' });
    expect(approved.body.setupUrl).toBeTruthy();
  });

  test('approving again replaces the link, so a lost one can be sent afresh', async () => {
    const code = await openAndGetCode();
    const first = await approveForLink(code);
    const second = await decide(first.id, 'APPROVE');
    const secondCode = decodeURIComponent(String(second.body.setupUrl).split('/moderator/join/')[1]);
    expect(secondCode).not.toBe(first.setupCode);
    expect((await setupLookup(first.setupCode)).status).toBe(404);
    expect((await setupLookup(secondCode)).status).toBe(200);
    expect(shared.mail).toHaveLength(2);
  });

  test('declining withdraws the link, and reconsidering puts the application back', async () => {
    const code = await openAndGetCode();
    const { id, setupCode } = await approveForLink(code);
    expect(await decide(id, 'DECLINE')).toMatchObject({ status: 200, body: { outcome: 'DECLINED' } });
    expect((await setupLookup(setupCode)).status).toBe(404);
    expect((await rows('SELECT status, setup_code_hash AS hash FROM moderator_applications WHERE id = ?', [id]))[0]).toEqual({ status: 'DECLINED', hash: null });
    expect(await decide(id, 'DECLINE')).toMatchObject({ status: 409 });
    expect(await decide(id, 'RECONSIDER')).toMatchObject({ status: 200, body: { outcome: 'RECONSIDERED' } });
    expect((await rows('SELECT status FROM moderator_applications WHERE id = ?', [id]))[0].status).toBe('PENDING');
    expect(await decide(id, 'APPROVE')).toMatchObject({ status: 200, body: { outcome: 'LINK' } });
    expect(await events('MODERATOR_APPLICATION_DECLINED')).toHaveLength(1);
  });

  test('only the owner decides, and only for this game', async () => {
    const code = await openAndGetCode();
    const id = await applyAndFind(code, 'Nia', 'nia@pilot.test');
    as('cora');
    expect(await decide(id, 'APPROVE')).toMatchObject({ status: 403 });
    as('stranger');
    expect((await decide(id, 'APPROVE')).status).toBe(403);
    expect((await decide(id, 'APPROVE', 'other')).status).toBe(404);
    as(null);
    expect((await decide(id, 'APPROVE')).status).toBe(401);
    as('owner');
    expect((await decide('missing', 'APPROVE')).status).toBe(404);
    expect((await decide(id, 'MAYBE')).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS count FROM moderator_applications WHERE status = 'PENDING'")).toBe(1);
    expect(shared.mail).toEqual([]);
  });

  test('a game that has ended cannot approve anyone', async () => {
    const code = await openAndGetCode();
    const id = await applyAndFind(code, 'Nia', 'nia@pilot.test');
    await client.execute("UPDATE games SET status = 'STOPPED' WHERE id = 'game'");
    expect(await decide(id, 'APPROVE')).toMatchObject({ status: 409 });
    expect(shared.mail).toEqual([]);
  });
});

describe('approving an applicant who already has a moderator account', () => {
  test('adds them as a co-moderator at once, with no link, and tells them by email', async () => {
    const code = await openAndGetCode();
    const id = await applyAndFind(code, 'Sam Stranger', 'stranger@pilot.test');
    const approved = await decide(id, 'APPROVE');
    expect(approved).toMatchObject({ status: 200, body: { outcome: 'ADDED', email: 'SENT' } });
    expect(approved.body.setupUrl).toBeUndefined();
    expect(await rows("SELECT role FROM game_moderators WHERE game_id = 'game' AND moderator_id = 'stranger'")).toEqual([{ role: 'CO_MODERATOR' }]);
    expect(await events('CO_MODERATOR_ADDED')).toEqual([{ actor: 'owner', payload: expect.stringContaining('"email":"stranger@pilot.test"') }]);
    expect(shared.mail[0]).toMatchObject({ to: 'stranger@pilot.test', subject: 'You’re approved to moderate Office Campaign' });
    expect(shared.mail[0].text).toContain(`${ORIGIN}/moderator`);
    expect((await list()).body.applications[0]).toMatchObject({ status: 'APPROVED', joined: true });
    expect(await decide(id, 'APPROVE')).toMatchObject({ status: 409 });
  });

  test('two approvals at once add them once', async () => {
    const code = await openAndGetCode();
    const id = await applyAndFind(code, 'Sam', 'stranger@pilot.test');
    const results = await Promise.all([decide(id, 'APPROVE'), decide(id, 'APPROVE')]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS count FROM game_moderators WHERE game_id = 'game' AND moderator_id = 'stranger'")).toBe(1);
    expect(await events('CO_MODERATOR_ADDED')).toHaveLength(1);
  });

  test('someone added another way since they applied is recorded and not added twice', async () => {
    const code = await openAndGetCode();
    const id = await applyAndFind(code, 'Sam', 'stranger@pilot.test');
    await client.execute("INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','stranger','CO_MODERATOR','2026-01-02')");
    expect(await decide(id, 'APPROVE')).toMatchObject({ status: 200, body: { outcome: 'ALREADY_MEMBER' } });
    expect(await count("SELECT COUNT(*) AS count FROM game_moderators WHERE game_id = 'game' AND moderator_id = 'stranger'")).toBe(1);
    expect(shared.mail).toEqual([]);
  });
});

describe('the setup link', () => {
  test('greets the applicant by name and shows the game, nothing more', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code, 'Nia Newcomer', 'nia@pilot.test');
    expect(await setupLookup(setupCode)).toMatchObject({ status: 200, body: { ok: true, link: { displayName: 'Nia Newcomer', gameName: 'Office Campaign' } } });
    expect(Object.keys((await setupLookup(setupCode)).body.link).sort()).toEqual(['displayName', 'gameName']);
  });

  test('creates the account, makes them a co-moderator, signs them in, and gives their recovery codes once', async () => {
    const code = await openAndGetCode();
    const { id, setupCode } = await approveForLink(code, 'Nia Newcomer', 'nia@pilot.test');
    const done = await redeem(setupCode);
    expect(done).toMatchObject({ status: 200, body: { ok: true, gameName: 'Office Campaign' } });
    expect(done.body.recoveryCodes).toHaveLength(8);

    const account = (await rows("SELECT id FROM moderator_accounts WHERE email = 'nia@pilot.test'"))[0];
    expect(account).toBeTruthy();
    expect(shared.signedIn).toEqual([account.id]);
    expect(await rows('SELECT role FROM game_moderators WHERE game_id = ? AND moderator_id = ?', ['game', String(account.id)])).toEqual([{ role: 'CO_MODERATOR' }]);
    expect(await authenticateModerator('nia@pilot.test', PASSWORD)).toMatchObject({ email: 'nia@pilot.test' });
    expect(await authenticateModerator('nia@pilot.test', 'not the password')).toBeNull();
    expect((await rows('SELECT setup_used_at AS used, setup_code_hash AS hash, moderator_id AS moderator FROM moderator_applications WHERE id = ?', [id]))[0]).toMatchObject({ hash: null, moderator: account.id });
    expect((await rows('SELECT setup_used_at AS used FROM moderator_applications WHERE id = ?', [id]))[0].used).toBeTruthy();
    expect(await events('CO_MODERATOR_ADDED')).toEqual([{ actor: 'owner', payload: expect.stringContaining('"email":"nia@pilot.test"') }]);
    // The recovery codes are hashed in the database.
    const stored = String((await rows('SELECT recovery_codes_json AS codes FROM moderator_accounts WHERE id = ?', [String(account.id)]))[0].codes);
    for (const recovery of done.body.recoveryCodes as string[]) expect(stored).not.toContain(recovery);
    expect((await list()).body.applications[0]).toMatchObject({ joined: true });
  });

  test('works once: the link is dead afterwards', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code);
    expect((await redeem(setupCode)).status).toBe(200);
    expect(await redeem(setupCode, 'another-long-password')).toMatchObject({ status: 404, body: { error: MODERATOR_SETUP_COPY.invalidLink } });
    expect((await setupLookup(setupCode)).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS count FROM moderator_accounts WHERE email = 'newcomer@pilot.test'")).toBe(1);
  });

  test('two uses at the same moment create one account', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code);
    const results = await Promise.all([redeem(setupCode, 'first-long-password'), redeem(setupCode, 'second-long-password')]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status !== 200).every((result) => result.status === 404 || result.status === 409)).toBe(true);
    expect(await count("SELECT COUNT(*) AS count FROM moderator_accounts WHERE email = 'newcomer@pilot.test'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM game_moderators WHERE game_id = 'game'")).toBe(3);
  });

  test('refuses a short password and creates nothing', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code);
    expect(await redeem(setupCode, 'short')).toMatchObject({ status: 400 });
    expect(await redeem(setupCode, 12345)).toMatchObject({ status: 400 });
    expect(await count("SELECT COUNT(*) AS count FROM moderator_accounts WHERE email = 'newcomer@pilot.test'")).toBe(0);
    expect((await setupLookup(setupCode)).status).toBe(200);
  });

  test('expires after seven days', async () => {
    const code = await openAndGetCode();
    const { id, setupCode } = await approveForLink(code);
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    await client.execute({ sql: 'UPDATE moderator_applications SET decided_at = ? WHERE id = ?', args: [eightDaysAgo, id] });
    expect((await setupLookup(setupCode)).status).toBe(404);
    expect((await redeem(setupCode)).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS count FROM moderator_accounts WHERE email = 'newcomer@pilot.test'")).toBe(0);
    expect((await list()).body.applications[0]).toMatchObject({ linkExpired: true });
    // The owner can send a fresh one.
    expect(await decide(id, 'APPROVE')).toMatchObject({ status: 200, body: { outcome: 'LINK' } });
  });

  test('does not work once the game is over', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code);
    await client.execute("UPDATE games SET status = 'CANCELLED' WHERE id = 'game'");
    expect((await setupLookup(setupCode)).status).toBe(404);
    expect((await redeem(setupCode)).status).toBe(404);
    expect(await count("SELECT COUNT(*) AS count FROM moderator_accounts WHERE email = 'newcomer@pilot.test'")).toBe(0);
  });

  test('says so when an account already exists for the email by the time it is used', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code);
    await client.execute("INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('late','newcomer@pilot.test','x','[]','2026-01-02','2026-01-02')");
    expect((await setupLookup(setupCode)).status).toBe(404);
    expect(await redeem(setupCode)).toMatchObject({ status: 409, body: { error: expect.stringContaining('already exists') } });
    expect(await count("SELECT COUNT(*) AS count FROM game_moderators WHERE moderator_id = 'late'")).toBe(0);
  });

  test('an unknown or malformed link is a 404', async () => {
    await openAndGetCode();
    for (const code of ['nope', 'x'.repeat(100), 'AAAAAAAAAAAA']) {
      expect((await setupLookup(code)).status).toBe(404);
      expect((await redeem(code)).status).toBe(404);
    }
  });

  test('a post from another site is refused', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code);
    const reply = await read(await setupPost(request('POST', { password: PASSWORD }, { origin: 'https://evil.example' }), codeCtx(setupCode)));
    expect(reply.status).toBe(403);
  });

  test('slows repeated tries on one link from one address', async () => {
    const code = await openAndGetCode();
    const { setupCode } = await approveForLink(code);
    let last: Reply | null = null;
    for (let attempt = 0; attempt < 9; attempt += 1) last = await read(await setupPost(request('POST', { password: 'short' }, { 'x-forwarded-for': '203.0.113.5' }), codeCtx(setupCode)));
    expect(last).toMatchObject({ status: 429 });
  });
});
