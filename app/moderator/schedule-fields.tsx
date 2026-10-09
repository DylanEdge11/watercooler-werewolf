'use client';

import type { GameSummary } from '@/lib/game/setup-view';

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;

/** What the schedule inputs start with: a new game's suggestions, or an existing game's saved values. */
export interface ScheduleValues {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
  /** A datetime-local value in the game's timezone. */
  finalCutoffAt: string;
  dayCloses: string;
  nightCloses: string;
  activeWeekdays: number[];
}

function dateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A new game's suggested schedule: weekdays, starting next Monday, for about a month, closing at 4 pm and 9 am. */
export function newGameSchedule(): ScheduleValues {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const daysUntilNextMonday = ((8 - start.getDay()) % 7) || 7;
  start.setDate(start.getDate() + daysUntilNextMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 25);
  const cutoffDate = dateInput(end);
  return {
    name: 'Office Werewolf Campaign',
    timezone: 'America/Regina',
    startDate: dateInput(start),
    endDate: cutoffDate,
    finalCutoffAt: `${cutoffDate}T16:00`,
    dayCloses: '16:00',
    nightCloses: '09:00',
    activeWeekdays: [1, 2, 3, 4, 5],
  };
}

export function savedSchedule(game: GameSummary): ScheduleValues {
  return {
    name: game.name,
    timezone: game.timezone,
    startDate: game.startDate,
    endDate: game.endDate,
    finalCutoffAt: game.finalCutoffLocal,
    dayCloses: game.schedule.dayCloses ?? '16:00',
    nightCloses: game.schedule.nightCloses ?? '09:00',
    activeWeekdays: game.activeWeekdays,
  };
}

/** The request body that both creating a game and saving its schedule send. */
export function scheduleRequestBody(form: FormData) {
  return {
    name: form.get('name'),
    timezone: form.get('timezone'),
    startDate: form.get('startDate'),
    endDate: form.get('endDate'),
    finalCutoffAt: form.get('finalCutoffAt'),
    activeWeekdays: form.getAll('activeWeekdays').map(Number),
    schedule: { dayCloses: form.get('dayCloses'), nightCloses: form.get('nightCloses') },
    hunterWindowHours: form.get('hunterWindowHours'),
    dayDivisor: form.get('dayDivisor'),
    nightDivisor: form.get('nightDivisor'),
    // Empty clears the schedule; a missing field (a disabled form) leaves it unchanged.
    eliminationSchedule: form.get('eliminationSchedule') ?? undefined,
    publicationMode: form.get('publicationMode'),
    reviewWindowMinutes: form.get('reviewWindowMinutes'),
  };
}

/** The schedule inputs shared by the new-game form and the game schedule card. */
export default function ScheduleFields({ values, disabled = false }: { values: ScheduleValues; disabled?: boolean }) {
  return <>
    <label className="wide">Game name<input name="name" defaultValue={values.name} disabled={disabled} required /></label>
    <label>Timezone<input name="timezone" defaultValue={values.timezone} disabled={disabled} required /></label>
    <label>Start date<input name="startDate" type="date" defaultValue={values.startDate} disabled={disabled} required /></label>
    <label>End date<input name="endDate" type="date" defaultValue={values.endDate} disabled={disabled} required /></label>
    <label>Final cutoff<input name="finalCutoffAt" type="datetime-local" defaultValue={values.finalCutoffAt} disabled={disabled} required /></label>
    <label>Day ballot closes<input name="dayCloses" type="time" defaultValue={values.dayCloses} disabled={disabled} required /></label>
    <label>Night actions close<input name="nightCloses" type="time" defaultValue={values.nightCloses} disabled={disabled} required /></label>
    <fieldset className="weekday-picker wide" disabled={disabled}><legend>Active weekdays</legend><div>{WEEKDAY_OPTIONS.map((day) => <label key={day.value}><input name="activeWeekdays" type="checkbox" value={day.value} defaultChecked={values.activeWeekdays.includes(day.value)} />{day.label}</label>)}</div></fieldset>
  </>;
}
