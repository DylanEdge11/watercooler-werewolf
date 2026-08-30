import { describe, expect, it } from 'vitest';
import { validatePilotFeedback } from './feedback';

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
