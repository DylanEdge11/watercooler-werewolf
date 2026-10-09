import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { LibsqlDatabase, type LibsqlClient } from '../db/libsql';
import { loadMigrations, runMigrations } from '../scripts/db-migration-runner.mjs';

const shared = vi.hoisted(() => ({ db: null as LibsqlDatabase | null, limiterCalls: 0 }));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/session', () => ({
  createPlayerSession: async () => {},
  createModeratorSession: async () => {},
}));
vi.mock('./http/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http/rate-limit')>()),
  // Counts the calls so a test can tell whether a request got as far as the per-device limit.
  enforceRateLimit: async () => { shared.limiterCalls += 1; },
}));

import { POST as loginPost } from '../app/api/seats/login/route';
import { POST as recoverPost } from '../app/api/moderators/recover/route';
import { redeemModeratorRecoveryCode } from './auth/moderators';

let client: Client;

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

// The shape that made the old email pattern quadratic: a long run of dots after "@" and then a character that fails the match.
const HOSTILE = `a@${'.'.repeat(32_000)},`;

beforeEach(async () => {
  client = createClient({ url: ':memory:' });
  await runMigrations(client, await loadMigrations());
  shared.db = new LibsqlDatabase(client as unknown as LibsqlClient);
  shared.limiterCalls = 0;
});

afterEach(() => {
  shared.db = null;
  client.close();
});

describe('seat sign-in input length', () => {
  test('a 32,000-character identifier is refused at once with the generic 401, before the rate limiter', async () => {
    const start = performance.now();
    const response = await loginPost(post('/api/seats/login', { identifier: HOSTILE, pin: '123456' }));
    const elapsed = performance.now() - start;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: expect.stringContaining('Email or seat code and PIN were not accepted.') });
    expect(elapsed).toBeLessThan(50);
    expect(shared.limiterCalls).toBe(0);
  });

  test('the older seatCode field is capped the same way', async () => {
    const response = await loginPost(post('/api/seats/login', { seatCode: HOSTILE, pin: '123456' }));
    expect(response.status).toBe(401);
    expect(shared.limiterCalls).toBe(0);
  });

  test('an identifier of exactly 254 characters still goes through the normal checks', async () => {
    const longest = `${'a'.repeat(254 - '@example.test'.length)}@example.test`;
    expect(longest).toHaveLength(254);
    const response = await loginPost(post('/api/seats/login', { identifier: longest, pin: '123456' }));
    expect(response.status).toBe(401);
    expect(shared.limiterCalls).toBe(1);
    expect((await loginPost(post('/api/seats/login', { identifier: `${longest}a`, pin: '123456' }))).status).toBe(401);
    expect(shared.limiterCalls).toBe(1);
  });
});

describe('moderator recovery input length', () => {
  test('redeeming with a 32,000-character email returns nothing, quickly', async () => {
    const start = performance.now();
    expect(await redeemModeratorRecoveryCode(HOSTILE, 'recovery-code-0000', 'a-long-new-password')).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });

  test('the recovery route answers its usual 401 for it', async () => {
    const start = performance.now();
    const response = await recoverPost(post('/api/moderators/recover', { email: HOSTILE, recoveryCode: 'recovery-code-0000', newPassword: 'a-long-new-password' }));
    expect(response.status).toBe(401);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
