import { describe, expect, it } from 'vitest';
import { shouldRefreshOperations } from './operations-refresh';

describe('moderator operations refresh policy', () => {
  it('invalidates health data after every live-game mutation, including publish', () => {
    expect(shouldRefreshOperations('PUBLISH')).toBe(true);
    expect(shouldRefreshOperations('ENTER_FINAL_SHOWDOWN')).toBe(true);
    expect(shouldRefreshOperations('UNRELATED_READ')).toBe(false);
    expect(shouldRefreshOperations(undefined)).toBe(true);
  });
});
