import { describe, expect, it } from 'vitest';
import { parseScheduledDate, sweepDuePhases, validateSchedule, zonedDateTimeToUtcIso } from './scheduling';

describe('timezone-aware scheduling', () => {
  it('converts local deadlines using the game timezone, including a DST boundary', () => {
    expect(zonedDateTimeToUtcIso('2026-07-01T16:00', 'America/Regina')).toBe('2026-07-01T22:00:00.000Z');
    expect(parseScheduledDate('2026-11-01T16:00', 'America/New_York').toISOString()).toBe('2026-11-01T21:00:00.000Z');
  });

  it('validates the configured weekday schedule', () => {
    expect(validateSchedule({ dayCloses: '16:00', nightCloses: '09:00', activeWeekdays: [1, 2, 3, 4, 5] })).toEqual([]);
    expect(validateSchedule({ dayCloses: '4pm', nightCloses: '09:00', activeWeekdays: [8] })).toHaveLength(2);
  });

  it('sweeps due games and is safe to call without a moderator actor', async () => {
    const fakeDb = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              all: async <T>() => sql.includes('DISTINCT p.game_id')
                ? { results: [{ gameId: 'game-1' }] as T[] }
                : { results: [{ id: 'phase-1', kind: 'DAY', closesAt: '2026-01-01T00:00:00.000Z' }] as T[] },
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        };
      },
      batch: async () => [],
    } as unknown as D1Database;
    await expect(sweepDuePhases(fakeDb, new Date('2026-01-01T00:00:01.000Z'))).resolves.toEqual([
      { gameId: 'game-1', phaseIds: ['phase-1'] },
    ]);
  });
});
