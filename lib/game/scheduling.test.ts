import { describe, expect, it } from 'vitest';
import { parseScheduledDate, validateSchedule, zonedDateTimeToUtcIso } from './scheduling';

describe('timezone-aware scheduling', () => {
  it('converts local deadlines using the game timezone, including a DST boundary', () => {
    expect(zonedDateTimeToUtcIso('2026-07-01T16:00', 'America/Regina')).toBe('2026-07-01T22:00:00.000Z');
    expect(parseScheduledDate('2026-11-01T16:00', 'America/New_York').toISOString()).toBe('2026-11-01T21:00:00.000Z');
  });

  it('validates the configured weekday schedule', () => {
    expect(validateSchedule({ dayCloses: '16:00', nightCloses: '09:00', activeWeekdays: [1, 2, 3, 4, 5] })).toEqual([]);
    expect(validateSchedule({ dayCloses: '4pm', nightCloses: '09:00', activeWeekdays: [8] })).toHaveLength(2);
  });
});
