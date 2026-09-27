import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS, formatHunterWindow, heavySlotWarning, resolveGameSettings, slotTable } from './game-settings';

describe('game settings', () => {
  it('defaults a new game to an eight-hour Hunter window and 30 players per slot', () => {
    expect(DEFAULT_GAME_SETTINGS).toEqual({ hunterWindowMinutes: 480, dayDivisor: 30, nightDivisor: 30 });
  });

  it('keeps current values for fields that are left out', () => {
    const current = { hunterWindowMinutes: 90, dayDivisor: 12, nightDivisor: 40 };
    expect(resolveGameSettings({}, current)).toEqual({ settings: current, errors: [] });
  });

  it('converts the Hunter window from hours and accepts form strings', () => {
    expect(resolveGameSettings({ hunterWindowHours: '1.5', dayDivisor: '10', nightDivisor: 20 }, DEFAULT_GAME_SETTINGS)).toEqual({
      settings: { hunterWindowMinutes: 90, dayDivisor: 10, nightDivisor: 20 },
      errors: [],
    });
  });

  it.each([0, -1, 0.1, 169, 'soon', ''])('rejects a Hunter window of %j hours', (hours) => {
    const result = resolveGameSettings({ hunterWindowHours: hours }, DEFAULT_GAME_SETTINGS);
    expect(result.errors).toEqual(['The Hunter window must be between 0.25 and 168 hours.']);
    expect(result.settings.hunterWindowMinutes).toBe(480);
  });

  it.each([0, -3, 2.5, 81, 'ten'])('rejects a divisor of %j', (divisor) => {
    const result = resolveGameSettings({ dayDivisor: divisor, nightDivisor: divisor }, DEFAULT_GAME_SETTINGS);
    expect(result.errors).toEqual([
      'Players per Day elimination must be a whole number from 1 to 80.',
      'Players per Night elimination must be a whole number from 1 to 80.',
    ]);
    expect(result.settings).toEqual(DEFAULT_GAME_SETTINGS);
  });

  it('previews one slot up to the divisor, two up to twice it, and so on', () => {
    expect(slotTable(30)).toEqual([
      { from: 1, to: 30, slots: 1 },
      { from: 31, to: 60, slots: 2 },
      { from: 61, to: 80, slots: 3 },
    ]);
    expect(slotTable(10, 25)).toEqual([
      { from: 1, to: 10, slots: 1 },
      { from: 11, to: 20, slots: 2 },
      { from: 21, to: 25, slots: 3 },
    ]);
    expect(slotTable(80)).toEqual([{ from: 1, to: 80, slots: 1 }]);
  });

  it('formats the Hunter window for people', () => {
    expect(formatHunterWindow(480)).toBe('8 hours');
    expect(formatHunterWindow(60)).toBe('1 hour');
    expect(formatHunterWindow(90)).toBe('1.5 hours');
    expect(formatHunterWindow(45)).toBe('45 minutes');
  });
});

describe('heavy elimination warning', () => {
  it('never warns for the default divisor of 30', () => {
    expect(heavySlotWarning(slotTable(30))).toBeNull();
  });

  it('points to the first player count where one phase can eliminate more than 3', () => {
    expect(heavySlotWarning(slotTable(20))).toEqual({ from: 61, to: 80, slots: 4 });
    expect(heavySlotWarning(slotTable(1))).toEqual({ from: 4, to: 4, slots: 4 });
  });
});
