import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';
import { hashSecret } from './auth/crypto';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null, sessions: [] as string[] }));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({ createPlayerSession: async (seatId: string) => { shared.sessions.push(seatId); } }));
vi.mock('./auth/authorization', () => ({ requireGameModerator: async () => ({ id: 'mod' }), requireGameOwner: async () => ({ id: 'mod' }) }));
vi.mock('./http/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http/rate-limit')>()),
  // The per-device limit is tested elsewhere; here every attempt reaches the PIN check.
  enforceRateLimit: async () => {},
}));

import { POST as loginPost } from '../app/api/seats/login/route';
import { POST as operationsPost } from '../app/api/games/[gameId]/operations/route';
import { purgeExpiredRows } from './maintenance';

let client: Client;

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

async function signIn(pin: string) {
  const response = await loginPost(post('/api/seats/login', { identifier: 'ana@pilot.test', pin }));
  return { status: response.status, body: await response.json() as { error?: string } };
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.sessions = [];
  await client.batch([
    { sql: "INSERT INTO moderator_accounts (id,email,password_hash,recovery_codes_json,created_at,updated_at) VALUES ('mod','owner@pilot.test','x','[]','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO games (id,name,status,timezone,start_date,end_date,active_weekdays_json,schedule_json,final_cutoff_at,created_by_moderator_id,created_at,updated_at) VALUES ('game','Lockout','ACTIVE','UTC','2026-01-01','2027-01-01','[1]','{}','2099-01-01','mod','2026-01-01','2026-01-01')", args: [] },
    { sql: "INSERT INTO game_moderators (game_id,moderator_id,role,added_at) VALUES ('game','mod','OWNER','2026-01-01')", args: [] },
    { sql: "INSERT INTO seats (id,game_id,display_name,email,status,claim_code_hash,pin_hash,created_at,updated_at) VALUES ('ana','game','Ana','ana@pilot.test','CLAIMED','claim-hash',?,'2026-01-01','2026-01-01')", args: [await hashSecret('123456')] },
  ], 'write');
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('PIN lockout', () => {
  test('ten wrong PINs in a row lock the seat until a moderator resets the PIN', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) expect((await signIn('000000')).status).toBe(401);
    // Even the right PIN is refused now.
    expect(await signIn('123456')).toEqual({ status: 423, body: expect.objectContaining({ error: expect.stringContaining('Ask your moderator') }) });
    expect(shared.sessions).toEqual([]);

    const reset = await operationsPost(post('/api/games/game/operations', { action: 'RESET_PLAYER_PIN', seatId: 'ana', newPin: '654321', reason: 'Locked after wrong PINs' }), { params: Promise.resolve({ gameId: 'game' }) });
    expect(reset.status).toBe(200);
    expect((await signIn('654321')).status).toBe(200);
    expect(shared.sessions).toEqual(['ana']);
  });

  test('a correct PIN clears the count, so only wrong PINs in a row lock', async () => {
    for (let attempt = 0; attempt < 9; attempt += 1) await signIn('000000');
    expect((await signIn('123456')).status).toBe(200);
    for (let attempt = 0; attempt < 9; attempt += 1) await signIn('000000');
    expect((await signIn('123456')).status).toBe(200);
  });
});

describe('expired-row cleanup', () => {
  test('deletes expired sessions and stale buckets but keeps PIN lockout counts', async () => {
    await client.batch([
      { sql: "INSERT INTO seat_sessions (id,seat_id,token_hash,session_version,expires_at,created_at) VALUES ('old','ana','t1',1,'2026-01-01T00:00:00.000Z','2026-01-01'), ('live','ana','t2',1,'2099-01-01T00:00:00.000Z','2026-01-01')", args: [] },
      { sql: "INSERT INTO moderator_sessions (id,moderator_id,token_hash,expires_at,created_at) VALUES ('old-mod','mod','m1','2026-01-01T00:00:00.000Z','2026-01-01')", args: [] },
      { sql: "INSERT INTO rate_limit_buckets (bucket_key,window_started_at,attempts) VALUES ('seat-login:x','2026-01-01T00:00:00.000Z',3), ('pin-failures:ana','2026-01-01T00:00:00.000Z',4)", args: [] },
    ], 'write');
    expect(await purgeExpiredRows(shared.db!, new Date('2026-09-26T00:00:00.000Z'))).toEqual({ moderatorSessions: 1, seatSessions: 1, rateLimitBuckets: 1 });
    expect((await client.execute('SELECT id FROM seat_sessions')).rows.map((row) => row.id)).toEqual(['live']);
    expect((await client.execute('SELECT bucket_key FROM rate_limit_buckets')).rows.map((row) => row.bucket_key)).toEqual(['pin-failures:ana']);
  });
});
