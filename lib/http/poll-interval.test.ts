import { describe, expect, it } from 'vitest';
import { pollInterval, RELAXED_POLL_MS, URGENT_POLL_MS } from './poll-interval';

const now = Date.parse('2026-10-05T12:00:00.000Z');
const inMinutes = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

describe('poll interval', () => {
  it('refreshes every 10 s only while an open phase closes within 15 minutes', () => {
    expect(pollInterval({ status: 'OPEN', deadline: inMinutes(14) }, now)).toBe(URGENT_POLL_MS);
    expect(pollInterval({ status: 'OPEN', deadline: inMinutes(-1) }, now)).toBe(URGENT_POLL_MS);
    expect(pollInterval({ status: 'OPEN', deadline: inMinutes(16) }, now)).toBe(RELAXED_POLL_MS);
  });

  it('relaxes to 30 s between phases, while waiting for review, or with no deadline', () => {
    expect(pollInterval(null, now)).toBe(RELAXED_POLL_MS);
    expect(pollInterval({ status: 'PENDING_APPROVAL', deadline: inMinutes(1) }, now)).toBe(RELAXED_POLL_MS);
    expect(pollInterval({ status: 'OPEN', deadline: null }, now)).toBe(RELAXED_POLL_MS);
  });
});
