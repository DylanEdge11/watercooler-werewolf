import { describe, expect, it } from 'vitest';
import { decideRateLimit, requestRateLimitKey } from './rate-limit';

describe('request rate-limit policy', () => {
  it('allows the configured burst, then reports a retry window', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(decideRateLimit({ attempts: 2, windowStartedAt: now, now, limit: 3, windowMs: 60_000 }).allowed).toBe(true);
    const blocked = decideRateLimit({ attempts: 3, windowStartedAt: now, now, limit: 3, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt.toISOString()).toBe('2026-10-01T12:01:00.000Z');
  });

  it('starts a fresh window after expiry and scopes buckets by subject and client', () => {
    const now = new Date('2026-10-01T12:01:01Z');
    expect(decideRateLimit({ attempts: 99, windowStartedAt: new Date('2026-10-01T12:00:00Z'), now, limit: 3, windowMs: 60_000 }).attempts).toBe(1);
    const request = new Request('https://game.test/api', { headers: { 'cf-connecting-ip': '203.0.113.10' } });
    expect(requestRateLimitKey(request, 'moderator-login')).toBe('moderator-login:203.0.113.10');
  });
});
