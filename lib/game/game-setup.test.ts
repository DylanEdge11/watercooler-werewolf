import { describe, expect, it } from 'vitest';
import { validateGameSetup } from './game-setup';

const valid = {
  name: 'Friday Coffee Club',
  timezone: 'America/Regina',
  startDate: '2026-10-05',
  endDate: '2026-10-30',
  finalCutoffAt: '2026-10-30T16:00',
  activeWeekdays: [1, 2, 3, 4, 5],
  schedule: { dayCloses: '16:00', nightCloses: '09:00' },
};

describe('game setup validation', () => {
  it('keeps only the two known schedule times, whatever else is sent', () => {
    const setup = validateGameSetup({ ...valid, schedule: { ...valid.schedule, extra: 'ignored' } });
    expect(setup.schedule).toEqual({ dayCloses: '16:00', nightCloses: '09:00' });
    expect(setup.finalCutoffAt.toISOString()).toBe('2026-10-30T22:00:00.000Z');
  });

  it('requires the final cutoff to fall between the start and end dates, in the game timezone', () => {
    expect(() => validateGameSetup({ ...valid, finalCutoffAt: '2026-10-04T23:59' })).toThrow('The final cutoff must fall between the start and end dates.');
    expect(() => validateGameSetup({ ...valid, finalCutoffAt: '2026-10-31T00:00' })).toThrow('between the start and end dates');
    expect(validateGameSetup({ ...valid, finalCutoffAt: '2026-10-05T00:00' }).startDate).toBe('2026-10-05');
  });

  it('keeps the existing messages for the other rules', () => {
    expect(() => validateGameSetup({ ...valid, name: 'ab' })).toThrow('Game name must be 3–80 characters.');
    expect(() => validateGameSetup({ ...valid, endDate: '2026-10-01' })).toThrow('The end date must be on or after the start date.');
    expect(() => validateGameSetup({ ...valid, activeWeekdays: [] })).toThrow('Choose at least one valid active weekday.');
    expect(() => validateGameSetup({ ...valid, schedule: { dayCloses: '25:00', nightCloses: '09:00' } })).toThrow('dayCloses must use HH:mm.');
  });
});
