import { calculateEliminationSlots } from './balance';
import { MAX_PLAYERS } from './player-count';

/** A new game gives an eliminated Hunter eight hours to shoot. */
const DEFAULT_HUNTER_WINDOW_MINUTES = 480;
/** One elimination slot per 30 living players, for Days and Nights alike. */
const DEFAULT_DIVISOR = 30;

const MIN_HUNTER_WINDOW_MINUTES = 15;
const MAX_HUNTER_WINDOW_MINUTES = 7 * 24 * 60;

export interface GameSettings {
  hunterWindowMinutes: number;
  dayDivisor: number;
  nightDivisor: number;
}

export interface GameSettingsInput {
  /** Hours as the moderator typed them, for example 8 or 1.5. */
  hunterWindowHours?: unknown;
  dayDivisor?: unknown;
  nightDivisor?: unknown;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  hunterWindowMinutes: DEFAULT_HUNTER_WINDOW_MINUTES,
  dayDivisor: DEFAULT_DIVISOR,
  nightDivisor: DEFAULT_DIVISOR,
};

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Validates the settings a moderator can change in the schedule form. A field
 * left out keeps its current value, so older clients and scripts still work.
 */
export function resolveGameSettings(input: GameSettingsInput, current: GameSettings): { settings: GameSettings; errors: string[] } {
  const errors: string[] = [];
  const settings = { ...current };

  if (input.hunterWindowHours !== undefined && input.hunterWindowHours !== null) {
    const hours = readNumber(input.hunterWindowHours);
    const minutes = hours === null ? null : Math.round(hours * 60);
    if (minutes === null || minutes < MIN_HUNTER_WINDOW_MINUTES || minutes > MAX_HUNTER_WINDOW_MINUTES) {
      errors.push('The Hunter window must be between 0.25 and 168 hours.');
    } else {
      settings.hunterWindowMinutes = minutes;
    }
  }

  for (const [key, label] of [['dayDivisor', 'Day'], ['nightDivisor', 'Night']] as const) {
    const raw = input[key];
    if (raw === undefined || raw === null) continue;
    const divisor = readNumber(raw);
    if (divisor === null || !Number.isInteger(divisor) || divisor < 1 || divisor > MAX_PLAYERS) {
      errors.push(`Players per ${label} elimination must be a whole number from 1 to ${MAX_PLAYERS}.`);
    } else {
      settings[key] = divisor;
    }
  }

  return { settings, errors };
}

export interface SlotTableRow {
  /** Living players, inclusive range. */
  from: number;
  to: number;
  slots: number;
}

/** The elimination slots a divisor produces for every living count up to the player limit. */
export function slotTable(divisor: number, maxPlayers = MAX_PLAYERS): SlotTableRow[] {
  const rows: SlotTableRow[] = [];
  for (let living = 1; living <= maxPlayers; living += 1) {
    const slots = calculateEliminationSlots(living, divisor);
    const last = rows.at(-1);
    if (last && last.slots === slots) last.to = living;
    else rows.push({ from: living, to: living, slots });
  }
  return rows;
}

/** More eliminations than this in one phase gets a warning in the form (the default of 30 never does). */
const HEAVY_SLOT_THRESHOLD = 3;

/** The first slot-table row that eliminates more than the threshold in one phase, if any. */
export function heavySlotWarning(rows: SlotTableRow[]): SlotTableRow | null {
  return rows.find((row) => row.slots > HEAVY_SLOT_THRESHOLD) ?? null;
}

/** "8 hours", "1.5 hours", or "45 minutes" for the guide, console, and form. */
export function formatHunterWindow(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
