import { describe, expect, it } from 'vitest';
import { assertSameOrigin, jsonError } from './security';

describe('HTTP mutation security', () => {
  it('accepts same-origin requests and non-browser requests without an Origin header', () => {
    expect(() => assertSameOrigin(new Request('https://game.test/api/action', { headers: { origin: 'https://game.test' } }))).not.toThrow();
    expect(() => assertSameOrigin(new Request('https://game.test/api/action'))).not.toThrow();
  });

  it('rejects cross-origin browser mutations and returns structured errors', async () => {
    expect(() => assertSameOrigin(new Request('https://game.test/api/action', { headers: { origin: 'https://attacker.test' } }))).toThrow('Cross-origin');
    const response = jsonError('Denied', 403);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Denied' });
  });
});
