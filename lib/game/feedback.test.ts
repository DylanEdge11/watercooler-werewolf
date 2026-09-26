import { describe, expect, it } from 'vitest';
import { summarizeFeedback, validatePilotFeedback } from './feedback';

describe('pilot feedback validation', () => {
  it('normalizes a bounded rating and optional comment', () => {
    expect(validatePilotFeedback({ rating: 5, comment: '  useful  ' })).toEqual({ rating: 5, comment: 'useful' });
    expect(validatePilotFeedback({ rating: 3 })).toEqual({ rating: 3, comment: null });
  });

  it('rejects out-of-range ratings and oversized comments', () => {
    expect(() => validatePilotFeedback({ rating: 0 })).toThrow('1 to 5');
    expect(() => validatePilotFeedback({ rating: 6 })).toThrow('1 to 5');
    expect(() => validatePilotFeedback({ rating: 4, comment: 'x'.repeat(2_001) })).toThrow('2,000');
  });
});

describe('feedback summary', () => {
  it('averages ratings to one decimal and keeps entries newest first without identities', () => {
    const summary = summarizeFeedback([
      { rating: 4, comment: null, respondentType: 'PLAYER', createdAt: '2026-10-01T10:00:00.000Z' },
      { rating: 5, comment: 'Loved the curtain call.', respondentType: 'MODERATOR', createdAt: '2026-10-02T10:00:00.000Z' },
      { rating: 2, comment: 'Too many emails.', respondentType: 'PLAYER', createdAt: '2026-10-01T12:00:00.000Z' },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(3.7);
    expect(summary.entries.map((entry) => entry.createdAt)).toEqual(['2026-10-02T10:00:00.000Z', '2026-10-01T12:00:00.000Z', '2026-10-01T10:00:00.000Z']);
    expect(Object.keys(summary.entries[0]).sort()).toEqual(['comment', 'createdAt', 'rating', 'respondentType']);
  });

  it('has no average when nothing was sent', () => {
    expect(summarizeFeedback([])).toEqual({ count: 0, average: null, entries: [] });
  });
});
