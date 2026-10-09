import { describe, expect, test, vi } from 'vitest';

vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/moderators', () => ({ hasModeratorAccount: async () => false }));

import * as bootstrapRoute from '../app/api/moderators/bootstrap/route';

describe('public moderator bootstrap boundary', () => {
  test('reports that the operator command is required without exposing a creation path', async () => {
    const status = await bootstrapRoute.GET();
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({ ok: true, needsBootstrap: true });

    // Only GET is exported, so a POST to this route is answered 405 and nothing can create an account here.
    expect(Object.keys(bootstrapRoute).sort()).toEqual(['GET']);
  });
});
