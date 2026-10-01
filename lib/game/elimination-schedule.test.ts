import { describe, expect, it } from 'vitest';
import { calculateEliminationSlots } from './balance';
import {
  capScheduledSlots,
  describeScheduleRow,
  parseEliminationSchedule,
  phaseSlots,
  resolveEliminationSchedule,
  scheduleProgress,
  scheduleRows,
  serializeEliminationSchedule,
  stageForGameDay,
  type EliminationSchedule,
} from './elimination-schedule';

// "2 / 2 for 5 days, then 3 / 2 for 4 days, then 1 / 1 until the end."
const OWNER_EXAMPLE: EliminationSchedule = [
  { day: 2, night: 2, days: 5 },
  { day: 3, night: 2, days: 4 },
  { day: 1, night: 1, days: null },
];

const divisors = { dayDivisor: 30, nightDivisor: 30 };

describe('stage lookup', () => {
  it.each([
    [1, 0], [5, 0], // the last day of stage 1 still belongs to it
    [6, 1], [9, 1],
    [10, 2], [40, 2], // the last stage runs until the game ends
  ])('game day %i uses stage %i', (gameDay, stageIndex) => {
    expect(stageForGameDay(OWNER_EXAMPLE, gameDay)).toBe(OWNER_EXAMPLE[stageIndex]);
  });

  it('a one-stage schedule applies to every day', () => {
    const single = [{ day: 2, night: 1, days: null }];
    expect(stageForGameDay(single, 1)).toBe(single[0]);
    expect(stageForGameDay(single, 99)).toBe(single[0]);
  });
});

describe('phase slots', () => {
  it('Day N and Night N are the same game day', () => {
    // Sequence 9 is Day 5, 10 is Night 5, 11 is Day 6.
    expect(phaseSlots({ ...divisors, kind: 'DAY', sequence: 9, livingPlayers: 50, schedule: OWNER_EXAMPLE })).toBe(2);
    expect(phaseSlots({ ...divisors, kind: 'NIGHT', sequence: 10, livingPlayers: 50, schedule: OWNER_EXAMPLE })).toBe(2);
    expect(phaseSlots({ ...divisors, kind: 'DAY', sequence: 11, livingPlayers: 50, schedule: OWNER_EXAMPLE })).toBe(3);
    expect(phaseSlots({ ...divisors, kind: 'NIGHT', sequence: 12, livingPlayers: 50, schedule: OWNER_EXAMPLE })).toBe(2);
    expect(phaseSlots({ ...divisors, kind: 'DAY', sequence: 19, livingPlayers: 50, schedule: OWNER_EXAMPLE })).toBe(1);
  });

  it('caps a phase so it cannot eliminate every living player, and never goes below 1', () => {
    expect(capScheduledSlots(3, 3)).toBe(2);
    expect(capScheduledSlots(3, 4)).toBe(3);
    expect(capScheduledSlots(5, 2)).toBe(1);
    expect(capScheduledSlots(1, 1)).toBe(1);
    expect(phaseSlots({ ...divisors, kind: 'DAY', sequence: 11, livingPlayers: 3, schedule: OWNER_EXAMPLE })).toBe(2);
  });

  it('without a schedule, uses the divisor formula unchanged', () => {
    for (const living of [1, 20, 30, 31, 61, 80]) {
      expect(phaseSlots({ kind: 'DAY', sequence: 1, livingPlayers: living, dayDivisor: 10, nightDivisor: 25, schedule: null })).toBe(calculateEliminationSlots(living, 10));
      expect(phaseSlots({ kind: 'NIGHT', sequence: 2, livingPlayers: living, dayDivisor: 10, nightDivisor: 25, schedule: null })).toBe(calculateEliminationSlots(living, 25));
    }
  });

  it('final ballots keep the Day divisor even with a schedule', () => {
    expect(phaseSlots({ kind: 'FINAL_BALLOT', sequence: 30, livingPlayers: 45, dayDivisor: 30, nightDivisor: 30, schedule: OWNER_EXAMPLE })).toBe(2);
    expect(phaseSlots({ kind: 'FINAL_BALLOT', sequence: 30, livingPlayers: 8, dayDivisor: 30, nightDivisor: 30, schedule: OWNER_EXAMPLE })).toBe(1);
  });
});

describe('validation', () => {
  it('leaves the schedule alone when the field is left out, and clears it when empty', () => {
    expect(resolveEliminationSchedule(undefined, OWNER_EXAMPLE)).toEqual({ schedule: OWNER_EXAMPLE, errors: [] });
    expect(resolveEliminationSchedule(null, OWNER_EXAMPLE)).toEqual({ schedule: null, errors: [] });
    expect(resolveEliminationSchedule('', OWNER_EXAMPLE)).toEqual({ schedule: null, errors: [] });
    expect(resolveEliminationSchedule([], OWNER_EXAMPLE)).toEqual({ schedule: null, errors: [] });
  });

  it('accepts form strings and JSON text, and ignores the last stage’s day count', () => {
    const json = JSON.stringify([{ day: '2', night: '2', days: '5' }, { day: '1', night: '1', days: '7' }]);
    expect(resolveEliminationSchedule(json, null)).toEqual({
      schedule: [{ day: 2, night: 2, days: 5 }, { day: 1, night: 1, days: null }],
      errors: [],
    });
  });

  it('explains every problem in plain language and keeps the current schedule', () => {
    const result = resolveEliminationSchedule([{ day: 0, night: 'two', days: 0 }, { day: 80, night: 1.5 }], OWNER_EXAMPLE);
    expect(result.schedule).toBe(OWNER_EXAMPLE);
    expect(result.errors).toEqual([
      'Stage 1: Day eliminations must be a whole number from 1 to 79.',
      'Stage 1: Night kills must be a whole number from 1 to 79.',
      'Stage 1: the number of game days must be a whole number from 1 to 365.',
      'Stage 2: Day eliminations must be a whole number from 1 to 79.',
      'Stage 2: Night kills must be a whole number from 1 to 79.',
    ]);
  });

  it('rejects unreadable input and too many stages', () => {
    expect(resolveEliminationSchedule('{oops', null).errors).toEqual(['The elimination schedule could not be read. Refresh the page and try again.']);
    expect(resolveEliminationSchedule({ day: 1 }, null).errors).toHaveLength(1);
    const many = Array.from({ length: 13 }, () => ({ day: 1, night: 1, days: 1 }));
    expect(resolveEliminationSchedule(many, null).errors).toEqual(['An elimination schedule can have at most 12 stages.']);
  });

  it('round-trips through the stored column; anything unreadable means no schedule', () => {
    expect(parseEliminationSchedule(serializeEliminationSchedule(OWNER_EXAMPLE))).toEqual(OWNER_EXAMPLE);
    expect(serializeEliminationSchedule(null)).toBeNull();
    expect(parseEliminationSchedule(null)).toBeNull();
    expect(parseEliminationSchedule('not json')).toBeNull();
    expect(parseEliminationSchedule('[{"day":0,"night":1,"days":null}]')).toBeNull();
  });
});

describe('preview and progress', () => {
  it('describes each stage by game day', () => {
    expect(scheduleRows(OWNER_EXAMPLE).map(describeScheduleRow)).toEqual([
      'Day 1–5: 2 Day / 2 Night',
      'Day 6–9: 3 Day / 2 Night',
      'Day 10 until the end: 1 Day / 1 Night',
    ]);
    expect(describeScheduleRow({ fromDay: 6, toDay: 6, day: 1, night: 2 })).toBe('Day 6: 1 Day / 2 Night');
  });

  it('before the first phase, nothing is played and a change applies from Day 1', () => {
    const progress = scheduleProgress(OWNER_EXAMPLE, null);
    expect(progress.currentGameDay).toBeNull();
    expect(progress.playedThrough).toBe(0);
    expect(progress.next).toEqual({ kind: 'DAY', gameDay: 1 });
    expect(progress.rows.map((row) => row.state)).toEqual(['UPCOMING', 'UPCOMING', 'UPCOMING']);
  });

  it('marks played stages and the current game day; the next phase is the first a change affects', () => {
    // Day 6 is open (sequence 11): days 1–5 are played, stage 2 holds day 6, Night 6 opens next.
    const duringDay = scheduleProgress(OWNER_EXAMPLE, { kind: 'DAY', sequence: 11, status: 'OPEN' });
    expect(duringDay).toMatchObject({ playedThrough: 5, currentGameDay: 6, next: { kind: 'NIGHT', gameDay: 6 } });
    expect(duringDay.rows.map((row) => row.state)).toEqual(['PLAYED', 'CURRENT', 'UPCOMING']);
    // Night 9 still open (sequence 18): day 9 is not played yet.
    const duringNight = scheduleProgress(OWNER_EXAMPLE, { kind: 'NIGHT', sequence: 18, status: 'OPEN' });
    expect(duringNight).toMatchObject({ playedThrough: 8, currentGameDay: 9, next: { kind: 'DAY', gameDay: 10 } });
    expect(duringNight.rows.map((row) => row.state)).toEqual(['PLAYED', 'CURRENT', 'UPCOMING']);
    // Night 9 published: stage 2 is played and Day 10 starts the last stage.
    const afterNight = scheduleProgress(OWNER_EXAMPLE, { kind: 'NIGHT', sequence: 18, status: 'PUBLISHED' });
    expect(afterNight).toMatchObject({ playedThrough: 9, currentGameDay: 10, next: { kind: 'DAY', gameDay: 10 } });
    expect(afterNight.rows.map((row) => row.state)).toEqual(['PLAYED', 'PLAYED', 'CURRENT']);
  });
});
