import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null, beforeHash: null as (() => Promise<void>) | null }));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }) }));
vi.mock('../lib/auth/session', () => ({
  createPlayerSession: async () => {},
  prepareSpectatorSession: async (spectatorId: string, sessionVersion: number) => ({
    values: [crypto.randomUUID(), spectatorId, `token-${crypto.randomUUID()}`, sessionVersion, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    setCookie: async () => {},
  }),
}));
// Lets one test run something between the route reading the spectator and writing the new PIN: a competing reset.
vi.mock('../lib/auth/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth/crypto')>();
  return { ...actual, hashSecret: async (secret: string) => { await shared.beforeHash?.(); return actual.hashSecret(secret); } };
});
vi.mock('../lib/http/rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('./http/rate-limit')>(),
  enforceRateLimit: async () => {},
}));

import { GET as spectatorsGet, POST as spectatorsPost } from '../app/api/games/[gameId]/spectators/route';
import { POST as resetPinPost } from '../app/api/games/[gameId]/spectators/[spectatorId]/reset-pin/route';
import { DELETE as spectatorDelete } from '../app/api/games/[gameId]/spectators/[spectatorId]/route';
import { POST as spectatePost } from '../app/api/spectate/[code]/route';
import { POST as loginPost } from '../app/api/seats/login/route';

let client: Client;
const gameContext = { params: Promise.resolve({ gameId: 'game' }) };

function post(path: string, body: Record<string, unknown>, origin = 'http://localhost:3000'): Request {
  return new Request(`http://localhost:3000${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
}

async function addSpectator(email = 'riley@pilot.test') {
  const response = await spectatorsPost(post('/api/games/game/spectators', { displayName: 'Riley Watcher', email }), gameContext);
  const body = await response.json() as { spectator: { id: string }; spectateUrl: string };
  return { id: body.spectator.id, code: decodeURIComponent(body.spectateUrl.split('/spectate/')[1]), email };
}

/** The spectator opens their link and chooses a PIN. */
async function claim(code: string, pin = '123456') {
  const response = await spectatePost(post(`/api/spectate/${code}`, { pin }), { params: Promise.resolve({ code }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function homePage(identifier: string, pin: string) {
  const response = await loginPost(post('/api/seats/login', { identifier, pin }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function resetPin(spectatorId: string, body: Record<string, unknown>, gameId = 'game', origin?: string) {
  const response = await resetPinPost(post(`/api/games/${gameId}/spectators/${spectatorId}/reset-pin`, body, origin), { params: Promise.resolve({ gameId, spectatorId }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function list() {
  const response = await spectatorsGet(new Request('http://localhost:3000/api/games/game/spectators'), gameContext);
  return (await response.json() as { spectators: Array<{ id: string; status: string; locked?: boolean }> }).spectators;
}

async function count(sql: string, args: Array<string | number> = []): Promise<number> {
  return Number((await client.execute({ sql, args })).rows[0]?.count);
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Spectator PIN reset','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
  ], 'write');
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('moderator resets a spectator\'s PIN', () => {
  test('a locked-out spectator is unlocked, signed out everywhere, and signs in with the new PIN by email and by link', async () => {
    const spectator = await addSpectator();
    await claim(spectator.code, '123456');
    expect((await homePage(spectator.email, '123456')).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS count FROM spectator_sessions WHERE spectator_id = ?', [spectator.id])).toBe(2);

    for (let attempt = 0; attempt < 10; attempt += 1) expect((await homePage(spectator.email, '000000')).status).toBe(401);
    expect((await homePage(spectator.email, '123456')).status).toBe(423);
    // The console list says who is locked, as it does for players.
    expect(await list()).toEqual([expect.objectContaining({ id: spectator.id, status: 'ACTIVE', locked: true })]);

    const reset = await resetPin(spectator.id, { newPin: '654321', reason: 'Locked out by wrong guesses' });
    expect(reset.status).toBe(200);
    expect(await count('SELECT COUNT(*) AS count FROM spectator_sessions WHERE spectator_id = ?', [spectator.id])).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM rate_limit_buckets WHERE bucket_key LIKE 'pin-failures:spectator:%'")).toBe(0);
    expect(await list()).toEqual([expect.objectContaining({ id: spectator.id, locked: false })]);

    expect((await homePage(spectator.email, '123456')).status).toBe(401);
    expect((await homePage(spectator.email, '654321')).status).toBe(200);
    expect((await claim(spectator.code, '654321')).body).toMatchObject({ ok: true, claimed: false });
    expect((await claim(spectator.code, '123456')).status).toBe(401);
  });

  test('the reason and the moderator go in the Operations log, never the PIN', async () => {
    const spectator = await addSpectator();
    await claim(spectator.code);
    await resetPin(spectator.id, { newPin: '654321', reason: 'Forgot their PIN' });
    const [event] = (await client.execute("SELECT severity, source, message, details_json AS details FROM operational_events WHERE game_id = 'game'")).rows;
    expect(event).toMatchObject({ severity: 'WARNING', source: 'SPECTATOR_ACCESS', message: 'A spectator PIN was reset by a moderator.' });
    expect(JSON.parse(String(event.details))).toEqual({ spectatorId: spectator.id, reason: 'Forgot their PIN', moderatorId: 'mod' });
    expect(JSON.stringify((await client.execute('SELECT * FROM operational_events')).rows)).not.toContain('654321');
    expect(JSON.stringify((await client.execute('SELECT * FROM game_events')).rows)).not.toContain('654321');
  });

  test.each([
    ['a PIN that is not six digits', { newPin: '12345', reason: 'Forgot their PIN' }, 400],
    ['a PIN with letters', { newPin: '12345a', reason: 'Forgot their PIN' }, 400],
    ['a missing PIN', { reason: 'Forgot their PIN' }, 400],
    ['a reason under five characters', { newPin: '654321', reason: 'no' }, 400],
  ])('refuses %s and changes nothing', async (_what, body, status) => {
    const spectator = await addSpectator();
    await claim(spectator.code);
    const before = (await client.execute({ sql: 'SELECT pin_hash AS pin, session_version AS version FROM spectators WHERE id = ?', args: [spectator.id] })).rows[0];
    expect((await resetPin(spectator.id, body)).status).toBe(status);
    expect((await client.execute({ sql: 'SELECT pin_hash AS pin, session_version AS version FROM spectators WHERE id = ?', args: [spectator.id] })).rows[0]).toEqual(before);
    expect(await count('SELECT COUNT(*) AS count FROM operational_events')).toBe(0);
  });

  test('a spectator who has not opened their link has no PIN to reset, and a removed or foreign one is not found', async () => {
    const invited = await addSpectator();
    const notOpened = await resetPin(invited.id, { newPin: '654321', reason: 'Forgot their PIN' });
    expect(notOpened.status).toBe(409);
    expect(notOpened.body.error).toEqual(expect.stringContaining('has not opened'));
    // They can still choose their own PIN afterwards.
    expect((await claim(invited.code, '111111')).body).toMatchObject({ ok: true, claimed: true });

    expect((await resetPin('missing', { newPin: '654321', reason: 'Forgot their PIN' })).status).toBe(404);
    await client.batch([
      { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('other','Other','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
      { sql: "INSERT INTO spectators (id,game_id,display_name,email,status,claim_code_hash,pin_hash,created_at,updated_at) VALUES ('foreign','other','Foreign','foreign@pilot.test','ACTIVE','foreign-hash','x','2026-01-01','2026-01-01')", args: [] },
    ], 'write');
    expect((await resetPin('foreign', { newPin: '654321', reason: 'Forgot their PIN' })).status).toBe(404);

    await spectatorDelete(new Request('http://localhost:3000/api/x', { method: 'DELETE', headers: { origin: 'http://localhost:3000' } }), { params: Promise.resolve({ gameId: 'game', spectatorId: invited.id }) });
    expect((await resetPin(invited.id, { newPin: '654321', reason: 'Forgot their PIN' })).status).toBe(404);
  });

  test('a reset that lost a race to another reset changes nothing, even when both land in the same millisecond', async () => {
    const spectator = await addSpectator();
    await claim(spectator.code);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    try {
      // Another moderator's reset lands first, with its own new session and a fresh wrong-PIN count after it.
      shared.beforeHash = async () => {
        await client.execute({ sql: "UPDATE spectators SET pin_hash = 'competitor', session_version = session_version + 1, updated_at = '2026-06-01T12:00:00.000Z' WHERE id = ?", args: [spectator.id] });
        await client.execute({ sql: "INSERT INTO spectator_sessions (id,spectator_id,token_hash,session_version,expires_at,created_at) VALUES ('fresh', ?, 'fresh-token', 2, '2099-01-01', '2026-01-01')", args: [spectator.id] });
        await client.execute({ sql: "INSERT INTO rate_limit_buckets (bucket_key,window_started_at,attempts) VALUES (?, '2026-01-01', 3)", args: [`pin-failures:spectator:${spectator.id}`] });
      };
      const result = await resetPin(spectator.id, { newPin: '654321', reason: 'Forgot their PIN' });
      expect(result.status).toBe(409);
    } finally {
      shared.beforeHash = null;
      vi.useRealTimers();
    }
    // The other reset stands: its session and the count after it are untouched, and no audit entry was written for the loser.
    expect(await count("SELECT COUNT(*) AS count FROM spectator_sessions WHERE id = 'fresh'")).toBe(1);
    expect(await count('SELECT COUNT(*) AS count FROM rate_limit_buckets WHERE bucket_key = ?', [`pin-failures:spectator:${spectator.id}`])).toBe(1);
    expect(await count('SELECT COUNT(*) AS count FROM operational_events')).toBe(0);
    expect(String((await client.execute({ sql: 'SELECT pin_hash AS pin FROM spectators WHERE id = ?', args: [spectator.id] })).rows[0]?.pin)).toBe('competitor');
  });

  test('a request from another site is refused before anything happens', async () => {
    const spectator = await addSpectator();
    await claim(spectator.code);
    const result = await resetPin(spectator.id, { newPin: '654321', reason: 'Forgot their PIN' }, 'game', 'http://evil.test');
    expect(result.status).toBe(403);
    expect((await homePage(spectator.email, '123456')).status).toBe(200);
  });
});
