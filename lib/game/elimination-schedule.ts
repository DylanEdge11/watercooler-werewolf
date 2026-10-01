import { calculateEliminationSlots } from './balance';
import { MAX_PLAYERS } from './player-count';
import { cycleNumber } from './timeline-view';
import type { PhaseKind } from './types';

/**
 * One stage of a fixed elimination schedule: this many Day eliminations and
 * Night kills for each of `days` game days. The last stage has `days: null`
 * and runs until the game ends.
 */
export interface EliminationStage {
  day: number;
  night: number;
  days: number | null;
}

/** An ordered, non-empty list of stages. A game without one uses the divisors. */
export type EliminationSchedule = EliminationStage[];

export const MAX_SCHEDULE_STAGES = 12;
export const MAX_STAGE_DAYS = 365;
/** A phase always leaves at least one player alive, so more can never apply. */
export const MAX_STAGE_ELIMINATIONS = MAX_PLAYERS - 1;

function readWholeNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(number) ? number : null;
}

/**
 * Validates a schedule from the setup form, the live console, or a script.
 * `undefined` keeps the current schedule; `null`, `''`, or an empty list
 * removes it. A JSON string is accepted because the form sends one.
 */
export function resolveEliminationSchedule(
  raw: unknown,
  current: EliminationSchedule | null,
): { schedule: EliminationSchedule | null; errors: string[] } {
  if (raw === undefined) return { schedule: current, errors: [] };
  if (raw === null || raw === '') return { schedule: null, errors: [] };
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { schedule: current, errors: ['The elimination schedule could not be read. Refresh the page and try again.'] };
    }
  }
  if (!Array.isArray(value)) {
    return { schedule: current, errors: ['The elimination schedule could not be read. Refresh the page and try again.'] };
  }
  if (value.length === 0) return { schedule: null, errors: [] };
  if (value.length > MAX_SCHEDULE_STAGES) {
    return { schedule: current, errors: [`An elimination schedule can have at most ${MAX_SCHEDULE_STAGES} stages.`] };
  }

  const errors: string[] = [];
  const schedule: EliminationSchedule = value.map((entry, index) => {
    const stage = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const label = `Stage ${index + 1}`;
    const last = index === value.length - 1;
    const day = readWholeNumber(stage.day);
    const night = readWholeNumber(stage.night);
    const days = last ? null : readWholeNumber(stage.days);
    if (day === null || day < 1 || day > MAX_STAGE_ELIMINATIONS) {
      errors.push(`${label}: Day eliminations must be a whole number from 1 to ${MAX_STAGE_ELIMINATIONS}.`);
    }
    if (night === null || night < 1 || night > MAX_STAGE_ELIMINATIONS) {
      errors.push(`${label}: Night kills must be a whole number from 1 to ${MAX_STAGE_ELIMINATIONS}.`);
    }
    if (!last && (days === null || days < 1 || days > MAX_STAGE_DAYS)) {
      errors.push(`${label}: the number of game days must be a whole number from 1 to ${MAX_STAGE_DAYS}.`);
    }
    return { day: day ?? 0, night: night ?? 0, days };
  });
  return errors.length ? { schedule: current, errors } : { schedule, errors: [] };
}

/** Reads the stored column. Anything unreadable counts as no schedule, so the divisors apply. */
export function parseEliminationSchedule(json: string | null | undefined): EliminationSchedule | null {
  if (!json) return null;
  try {
    const { schedule, errors } = resolveEliminationSchedule(JSON.parse(json), null);
    return errors.length ? null : schedule;
  } catch {
    return null;
  }
}

/** The stored form: null for no schedule, so a game without one keeps a NULL column. */
export function serializeEliminationSchedule(schedule: EliminationSchedule | null): string | null {
  return schedule ? JSON.stringify(schedule) : null;
}

/** The stage that covers a game day (1-based). Days past the end use the last stage. */
export function stageForGameDay(schedule: EliminationSchedule, gameDay: number): EliminationStage {
  let lastDay = 0;
  for (const stage of schedule) {
    if (stage.days === null) return stage;
    lastDay += stage.days;
    if (gameDay <= lastDay) return stage;
  }
  return schedule[schedule.length - 1];
}

/** At least 1, and never so many that the phase could eliminate every living player. */
export function capScheduledSlots(requested: number, livingPlayers: number): number {
  return Math.max(1, Math.min(requested, livingPlayers - 1));
}

export interface PhaseSlotsInput {
  kind: PhaseKind;
  /** The sequence the new phase will have; Day N and Night N are game day N. */
  sequence: number;
  livingPlayers: number;
  dayDivisor: number;
  nightDivisor: number;
  schedule: EliminationSchedule | null;
}

/**
 * The slots a phase records when it opens. Days and Nights follow the schedule
 * when the game has one; final ballots, and every phase of a game without a
 * schedule, use the divisor formula unchanged.
 */
export function phaseSlots(input: PhaseSlotsInput): number {
  if (!input.schedule || input.kind === 'FINAL_BALLOT') {
    return calculateEliminationSlots(input.livingPlayers, input.kind === 'NIGHT' ? input.nightDivisor : input.dayDivisor);
  }
  const stage = stageForGameDay(input.schedule, cycleNumber(input.sequence));
  return capScheduledSlots(input.kind === 'NIGHT' ? stage.night : stage.day, input.livingPlayers);
}

export interface ScheduleRow {
  fromDay: number;
  /** Null for the last stage, which runs until the game ends. */
  toDay: number | null;
  day: number;
  night: number;
}

export function scheduleRows(schedule: EliminationSchedule): ScheduleRow[] {
  let fromDay = 1;
  return schedule.map((stage) => {
    const row = { fromDay, toDay: stage.days === null ? null : fromDay + stage.days - 1, day: stage.day, night: stage.night };
    if (stage.days !== null) fromDay += stage.days;
    return row;
  });
}

/** "Day 1–5: 2 Day / 2 Night", "Day 6: …", or "Day 10 until the end: …". */
export function describeScheduleRow(row: ScheduleRow): string {
  const days = row.toDay === null
    ? `Day ${row.fromDay} until the end`
    : row.toDay === row.fromDay ? `Day ${row.fromDay}` : `Day ${row.fromDay}–${row.toDay}`;
  return `${days}: ${row.day} Day / ${row.night} Night`;
}

export interface LatestRegularPhase {
  kind: PhaseKind;
  sequence: number;
  status: string;
}

export type ScheduleRowState = 'PLAYED' | 'CURRENT' | 'UPCOMING';

export interface ScheduleProgress {
  rows: Array<ScheduleRow & { state: ScheduleRowState }>;
  /** Game days finished: a game day is played once its Night is published. */
  playedThrough: number;
  /** The game day under way or next to start, or null before the first phase. */
  currentGameDay: number | null;
  /** The next Day or Night to open: the first phase a saved change affects. */
  next: { kind: 'DAY' | 'NIGHT'; gameDay: number };
}

/**
 * For the live console: which stages are played, which holds the current game
 * day, and which phase a change would first apply to. `latest` is the newest
 * Day or Night phase, whatever its status, since an opened phase keeps its slots.
 */
export function scheduleProgress(schedule: EliminationSchedule, latest: LatestRegularPhase | null): ScheduleProgress {
  const latestDay = latest ? cycleNumber(latest.sequence) : 0;
  const playedThrough = latest?.kind === 'NIGHT' && latest.status === 'PUBLISHED' ? latestDay : Math.max(0, latestDay - 1);
  const currentGameDay = latest ? playedThrough + 1 : null;
  const next: ScheduleProgress['next'] = latest?.kind === 'DAY'
    ? { kind: 'NIGHT', gameDay: latestDay }
    : { kind: 'DAY', gameDay: latestDay + 1 };
  const rows = scheduleRows(schedule).map((row) => {
    let state: ScheduleRowState = 'UPCOMING';
    if (row.toDay !== null && row.toDay <= playedThrough) state = 'PLAYED';
    else if (currentGameDay !== null && row.fromDay <= currentGameDay) state = 'CURRENT';
    return { ...row, state };
  });
  return { rows, playedThrough, currentGameDay, next };
}
