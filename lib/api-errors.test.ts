import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({
  db: null as LibsqlDatabase | null,
  moderator: null as { id: string; email: string } | null,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('./auth/session', () => ({ getCurrentModerator: async () => shared.moderator }));

import { GET as gamesGet, POST as gamesPost } from '../app/api/games/route';
import { GET as feedbackGet } from '../app/api/games/[gameId]/feedback/route';
import { GET as schedulerGet } from '../app/api/scheduler/deadlines/route';

let client: Client;

async function read(response: Response) {
  return { status: response.status, body: await response.json() as { ok: boolean; error?: string } };
}

function post(body: string): Request {
  return new Request('http://localhost:3000/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body,
  });
}

beforeEach(() => {
  client = createClient({ url: ':memory:' });
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.moderator = { id: 'mod', email: 'owner@pilot.test' };
});

afterEach(() => {
  shared.db = null;
  client.close();
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

async function migrateAndSeed(): Promise<void> {
  await runMigrations(client, await loadMigrations());
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('other','other@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Errors','REGISTRATION','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
  ], 'write');
}

describe('route status codes', () => {
  // Runs first: readiness is cached for the module once it succeeds.
  test('an unmigrated database answers 503, so "5xx means not migrated" holds', async () => {
    expect((await read(await gamesGet(new Request('http://localhost:3000/api/games')))).status).toBe(503);
  });

  test('a signed-out request is 401 and a moderator of another game is 403', async () => {
    await migrateAndSeed();
    const context = { params: Promise.resolve({ gameId: 'game' }) };
    shared.moderator = null;
    // The console's first request also learns whether the first account still has to be created.
    expect(await (await gamesGet(new Request('http://localhost:3000/api/games'))).json()).toMatchObject({ ok: false, needsBootstrap: false });
    shared.moderator = { id: 'other', email: 'other@pilot.test' };
    expect(await read(await feedbackGet(new Request('http://localhost:3000/api/games/game/feedback'), context)))
      .toEqual({ status: 403, body: { ok: false, error: 'You are not a moderator for this game.' } });
  });

  test('before any moderator account exists, the signed-out 401 says setup is needed', async () => {
    await runMigrations(client, await loadMigrations());
    shared.moderator = null;
    const response = await gamesGet(new Request('http://localhost:3000/api/games'));
    expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 401, body: { needsBootstrap: true } });
  });

  test('a body that is not JSON is a 400 with a plain message', async () => {
    await migrateAndSeed();
    expect(await read(await gamesPost(post('{not json')))).toEqual({ status: 400, body: { ok: false, error: 'The request body must be valid JSON.' } });
  });

  test('a database failure is a generic 500 that names no table or column', async () => {
    await migrateAndSeed();
    await client.execute('DROP TABLE game_events');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const created = await read(await gamesPost(post(JSON.stringify({
      name: 'Broken database',
      timezone: 'UTC',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      finalCutoffAt: '2026-10-30T16:00',
      activeWeekdays: [1, 2, 3, 4, 5],
      schedule: { dayCloses: '16:00', nightCloses: '09:00' },
    }))));
    expect(created.status).toBe(500);
    expect(created.body.error).not.toMatch(/game_events|no such table/iu);
  });

  test('the scheduler compares its secret and refuses a wrong one', async () => {
    await migrateAndSeed();
    process.env.CRON_SECRET = 'fictional-cron-secret';
    const call = (token: string) => schedulerGet(new Request('http://localhost:3000/api/scheduler/deadlines', { headers: { authorization: `Bearer ${token}` } }));
    expect((await call('fictional-cron-secreX')).status).toBe(401);
    expect((await call('fictional-cron-secret')).status).toBe(200);
  });
});
