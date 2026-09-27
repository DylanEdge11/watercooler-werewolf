import { describe, expect, it } from 'vitest';
import { withRetryAfter } from './retry-after';

const response = (status: number, retryAfter?: string) => ({ status, headers: new Headers(retryAfter ? { 'retry-after': retryAfter } : {}) });

describe('rate-limit wait message', () => {
  it('rounds the wait up to whole minutes', () => {
    expect(withRetryAfter('Too many attempts.', response(429, '600'))).toBe('Too many attempts. Try again in 10 minutes.');
    expect(withRetryAfter('Too many attempts.', response(429, '61'))).toBe('Too many attempts. Try again in 2 minutes.');
    expect(withRetryAfter('Too many attempts.', response(429, '20'))).toBe('Too many attempts. Try again in 1 minute.');
  });

  it('leaves other responses and a missing header alone', () => {
    expect(withRetryAfter('Not accepted.', response(401, '600'))).toBe('Not accepted.');
    expect(withRetryAfter('Too many attempts.', response(429))).toBe('Too many attempts.');
  });
});
