import { assertValidCalendarDate, assertValidTimeZone, formatZonedDateTimeLocal, parseScheduledDate, validateSchedule } from './scheduling';

/** What the create-game and schedule forms send. Settings and automation are validated separately. */
export interface GameSetupInput {
  name?: string;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  finalCutoffAt?: string;
  activeWeekdays?: number[];
  schedule?: Record<string, string>;
}

export interface GameSetup {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
  finalCutoffAt: Date;
  activeWeekdays: number[];
  /** Only the two known fields are kept, so nothing else a client sends is stored. */
  schedule: { dayCloses: string; nightCloses: string };
}

/**
 * The one set of rules for a game's name, dates, timezone, weekdays, and
 * phase times, shared by creating a game and editing its schedule. Throws an
 * Error with a message for the moderator.
 */
export function validateGameSetup(body: GameSetupInput): GameSetup {
  const name = body.name?.trim() ?? '';
  if (name.length < 3 || name.length > 80) throw new Error('Game name must be 3–80 characters.');
  if (!body.timezone) throw new Error('A game timezone is required.');
  assertValidTimeZone(body.timezone);
  if (!body.startDate || !body.endDate || !body.finalCutoffAt) throw new Error('Start, end, and final cutoff are required.');
  assertValidCalendarDate(body.startDate, 'Start date');
  assertValidCalendarDate(body.endDate, 'End date');
  if (body.startDate > body.endDate) throw new Error('The end date must be on or after the start date.');
  const finalCutoffAt = parseScheduledDate(body.finalCutoffAt, body.timezone);
  const cutoffDate = formatZonedDateTimeLocal(finalCutoffAt, body.timezone).slice(0, 10);
  if (cutoffDate < body.startDate || cutoffDate > body.endDate) {
    throw new Error('The final cutoff must fall between the start and end dates.');
  }
  if (
    !Array.isArray(body.activeWeekdays) || !body.activeWeekdays.length ||
    body.activeWeekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
  ) {
    throw new Error('Choose at least one valid active weekday.');
  }
  if (!body.schedule || Object.keys(body.schedule).length === 0) throw new Error('Enter the phase schedule.');
  const schedule = { dayCloses: body.schedule.dayCloses ?? '', nightCloses: body.schedule.nightCloses ?? '' };
  const scheduleErrors = validateSchedule({ ...schedule, activeWeekdays: body.activeWeekdays });
  if (scheduleErrors.length) throw new Error(scheduleErrors.join(' '));
  return { name, timezone: body.timezone, startDate: body.startDate, endDate: body.endDate, finalCutoffAt, activeWeekdays: body.activeWeekdays, schedule };
}
