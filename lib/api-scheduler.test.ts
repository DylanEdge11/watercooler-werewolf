import { afterEach, describe, expect, test, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  db: {},
  sweepCount: 0,
}));

vi.mock('../db', () => ({ getDb: () => shared.db }));
vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('../lib/game/automation-sweep', () => ({ sweepAutomation: async () => [] }));
vi.mock('../lib/maintenance', () => ({ purgeExpiredRows: async () => ({ moderatorSessions: 0, seatSessions: 0, rateLimitBuckets: 0 }) }));
vi.mock('../lib/game/scheduling', () => ({
  sweepDuePhases: async () => {
    shared.sweepCount += 1;
    return [{ gameId: 'game', phaseIds: ['phase'] }];
  },
}));

import { GET, POST } from '../app/api/scheduler/deadlines/route';

const originalCronSecret = process.env.CRON_SECRET;

function restoreCronSecret(): void {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
}

afterEach(() => {
  restoreCronSecret();
  shared.sweepCount = 0;
});

describe('authenticated deadline scheduler', () => {
  test('fails closed when CRON_SECRET is missing or incorrect', async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(new Request('http://localhost:3000/api/scheduler/deadlines'))).status).toBe(503);

    process.env.CRON_SECRET = 'fictional-cron-secret';
    expect((await GET(new Request('http://localhost:3000/api/scheduler/deadlines', {
      headers: { authorization: 'Bearer wrong-secret' },
    }))).status).toBe(401);
    expect(shared.sweepCount).toBe(0);
  });

  test('accepts authenticated GET and retained external-scheduler POST retries', async () => {
    process.env.CRON_SECRET = 'fictional-cron-secret';
    const headers = { authorization: 'Bearer fictional-cron-secret' };
    const getResponse = await GET(new Request('http://localhost:3000/api/scheduler/deadlines', { headers }));
    const postResponse = await POST(new Request('http://localhost:3000/api/scheduler/deadlines', {
      method: 'POST',
      headers,
    }));

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({ ok: true, lockedPhaseCount: 1 });
    await expect(postResponse.json()).resolves.toMatchObject({ ok: true, lockedPhaseCount: 1 });
    expect(shared.sweepCount).toBe(2);
  });
});
