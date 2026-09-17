import { describe, expect, test, vi } from 'vitest';

vi.mock('../db/migrate', () => ({ ensureDatabase: async () => {} }));
vi.mock('./auth/moderators', () => ({ hasModeratorAccount: async () => false }));

import { GET, POST } from '../app/api/moderators/bootstrap/route';

describe('public moderator bootstrap boundary', () => {
  test('reports that the operator command is required without exposing a creation path', async () => {
    const status = await GET();
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      ok: true,
      needsBootstrap: true,
      operatorBootstrapRequired: true,
    });

    const response = await POST(new Request('http://localhost:3000/api/moderators/bootstrap', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    }));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('owner:bootstrap'),
    });
  });
});
