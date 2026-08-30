import type { GameBackup } from './snapshot';
import { ROLE_CATALOG } from '../game/catalog';
import { canonicalRoleKey, ROLE_KEYS, type RoleKey } from '../game/types';

export interface BackupRestoreSeat {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
}

export interface BackupRestoreComposition {
  roleKey: RoleKey;
  count: number;
  powerSnapshot: number;
}

export interface BackupRestoreGame {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
  activeWeekdaysJson: string;
  scheduleJson: string;
  dayDivisor: number;
  nightDivisor: number;
  hunterWindowMinutes: number;
  finalRoundMinutes: number;
  chatRetentionDays: number;
  finalCutoffAt: string;
  publicationMode: 'REVIEW' | 'AUTOMATIC';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key] as string;
  }
  return null;
}

function readInteger(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/u.test(value)) return Number(value);
  }
  return null;
}

/**
 * Validate the non-secret portion of a stored backup before it is used for
 * recovery. Backups intentionally do not contain passwords, PIN hashes, or
 * claim hashes, so recovery always creates fresh private seat links.
 */
export function validateBackupForRestore(data: GameBackup, expectedGameId: string): string[] {
  const errors: string[] = [];
  if (data.schemaVersion !== 2) errors.push('This backup schema version is not supported by the current build.');
  const game = asRecord(data.game);
  if (!game || readString(game, 'id') !== expectedGameId) errors.push('The backup belongs to a different game.');
  if (!Array.isArray(data.seats) || data.seats.length < 20 || data.seats.length > 80) {
    errors.push('The backup must contain between 20 and 80 seats.');
  }
  const seatIds = new Set<string>();
  for (const rawSeat of data.seats ?? []) {
    const seat = asRecord(rawSeat);
    const id = seat ? readString(seat, 'id') : null;
    const displayName = seat ? readString(seat, 'displayName', 'display_name') : null;
    const email = seat ? readString(seat, 'email') : null;
    if (!id || !displayName || !email || !/^\S+@\S+\.\S+$/u.test(email)) {
      errors.push('Every backup seat must have an id, display name, and valid email.');
      continue;
    }
    if (seatIds.has(id)) errors.push('The backup contains duplicate seat ids.');
    seatIds.add(id);
  }
  const roleKeys = new Set(ROLE_KEYS);
  for (const rawCount of data.composition ?? []) {
    const count = asRecord(rawCount);
    const rawRole = count ? readString(count, 'roleKey', 'role_key') : null;
    const role = rawRole ? canonicalRoleKey(rawRole) : null;
    const amount = count ? readInteger(count, 'count') : null;
    if (!role || !roleKeys.has(role) || amount === null || amount < 0) {
      errors.push('The backup contains an invalid role composition.');
      continue;
    }
    if (amount > data.seats.length) errors.push('A role count cannot exceed the backed-up roster size.');
  }
  const backupGame = game ? backupGameFromRecord(game) : null;
  if (!backupGame) errors.push('The backup is missing valid game configuration.');
  return [...new Set(errors)];
}

export function backupGameFromRecord(game: Record<string, unknown>): BackupRestoreGame | null {
  const name = readString(game, 'name');
  const timezone = readString(game, 'timezone');
  const startDate = readString(game, 'startDate', 'start_date');
  const endDate = readString(game, 'endDate', 'end_date');
  const activeWeekdaysJson = readString(game, 'activeWeekdaysJson', 'active_weekdays_json');
  const scheduleJson = readString(game, 'scheduleJson', 'schedule_json');
  const finalCutoffAt = readString(game, 'finalCutoffAt', 'final_cutoff_at');
  const publicationMode = readString(game, 'publicationMode', 'publication_mode');
  const dayDivisor = readInteger(game, 'dayDivisor', 'day_divisor');
  const nightDivisor = readInteger(game, 'nightDivisor', 'night_divisor');
  const hunterWindowMinutes = readInteger(game, 'hunterWindowMinutes', 'hunter_window_minutes');
  const finalRoundMinutes = readInteger(game, 'finalRoundMinutes', 'final_round_minutes');
  const chatRetentionDays = readInteger(game, 'chatRetentionDays', 'chat_retention_days');
  if (
    !name || !timezone || !startDate || !endDate || !activeWeekdaysJson || !scheduleJson || !finalCutoffAt ||
    !['REVIEW', 'AUTOMATIC'].includes(publicationMode ?? '') ||
    dayDivisor === null || nightDivisor === null || hunterWindowMinutes === null || finalRoundMinutes === null || chatRetentionDays === null
  ) return null;
  try {
    JSON.parse(activeWeekdaysJson);
    JSON.parse(scheduleJson);
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    return null;
  }
  if (startDate.length !== 10 || endDate.length !== 10 || Number.isNaN(new Date(finalCutoffAt).valueOf())) return null;
  if (dayDivisor < 1 || nightDivisor < 1 || hunterWindowMinutes < 1 || finalRoundMinutes < 1 || chatRetentionDays < 1) return null;
  return {
    name,
    timezone,
    startDate,
    endDate,
    activeWeekdaysJson,
    scheduleJson,
    dayDivisor,
    nightDivisor,
    hunterWindowMinutes,
    finalRoundMinutes,
    chatRetentionDays,
    finalCutoffAt,
    publicationMode: publicationMode as BackupRestoreGame['publicationMode'],
  };
}

export function backupSeats(data: GameBackup): BackupRestoreSeat[] {
  return data.seats.flatMap((rawSeat) => {
    const seat = asRecord(rawSeat);
    if (!seat) return [];
    const id = readString(seat, 'id');
    const displayName = readString(seat, 'displayName', 'display_name');
    const email = readString(seat, 'email');
    if (!id || !displayName || !email) return [];
    return [{ id, displayName, email, createdAt: readString(seat, 'createdAt', 'created_at') ?? new Date().toISOString() }];
  });
}

export function backupComposition(data: GameBackup): BackupRestoreComposition[] {
  return data.composition.flatMap((rawCount) => {
    const count = asRecord(rawCount);
    if (!count) return [];
    const rawRole = readString(count, 'roleKey', 'role_key');
    const role = rawRole ? canonicalRoleKey(rawRole) : null;
    const amount = readInteger(count, 'count');
    if (!role || !ROLE_KEYS.includes(role) || amount === null || amount < 0) return [];
    return [{ roleKey: role, count: amount, powerSnapshot: readInteger(count, 'powerSnapshot', 'power_snapshot') ?? ROLE_CATALOG[role].power }];
  });
}

export function restoreConfirmation(gameName: string, confirmationName: string, confirmed: boolean): string | null {
  if (!confirmed || confirmationName !== gameName) return 'Restore requires typing the exact game name and explicit confirmation.';
  return null;
}
