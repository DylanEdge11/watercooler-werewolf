import type { Database, PreparedStatement } from '../../db/contracts';

export interface ScheduleDefinition {
  dayCloses: string;
  nightCloses: string;
  activeWeekdays?: number[];
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidParts(parts: LocalDateTimeParts): boolean {
  return parts.month >= 1
    && parts.month <= 12
    && parts.day >= 1
    && parts.day <= daysInMonth(parts.year, parts.month)
    && parts.hour >= 0
    && parts.hour <= 23
    && parts.minute >= 0
    && parts.minute <= 59
    && parts.second >= 0
    && parts.second <= 59;
}

function localParts(value: string): LocalDateTimeParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/u.exec(value);
  if (!match) throw new Error('Date and time must use YYYY-MM-DDTHH:mm.');
  const [, year, month, day, hour, minute, second = '0'] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) };
  if (!isValidParts(parts)) throw new Error('The date and time is not a real calendar value.');
  return parts;
}

/** Return whether a date-only input is a real Gregorian calendar date. */
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  return isValidParts({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0, second: 0 });
}

export function assertValidCalendarDate(value: string, label = 'Date'): void {
  if (!isValidCalendarDate(value)) throw new Error(`${label} must be a real YYYY-MM-DD calendar date.`);
}

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error('The game timezone must be a valid IANA timezone.');
  }
}

function formattedParts(instant: number, timeZone: string): LocalDateTimeParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function offsetAt(instant: number, timeZone: string): number {
  const parts = formattedParts(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
}

/** Convert a datetime-local value in the game's IANA zone to an absolute UTC ISO. */
export function zonedDateTimeToUtcIso(value: string, timeZone: string): string {
  assertValidTimeZone(timeZone);
  const parts = localParts(value);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Sample the nearby offsets, then verify candidates by formatting them back
  // in the zone. This makes DST gaps reject instead of normalizing to another
  // wall-clock value, while a repeated fall-back time deterministically uses
  // the earlier occurrence (the smaller UTC instant).
  const offsets = new Set(
    [-172_800_000, -86_400_000, -21_600_000, 0, 21_600_000, 86_400_000, 172_800_000]
      .map((delta) => offsetAt(localAsUtc + delta, timeZone)),
  );
  const candidates = [...offsets]
    .map((offset) => localAsUtc - offset)
    .filter((instant, index, all) => all.indexOf(instant) === index)
    .filter((instant) => sameParts(formattedParts(instant, timeZone), parts))
    .sort((left, right) => left - right);
  if (!candidates.length) {
    throw new Error('The selected local time does not exist in the game timezone (usually a daylight-saving transition).');
  }
  return new Date(candidates[0]).toISOString();
}

export function parseScheduledDate(value: string, timeZone: string): Date {
  if (!value || typeof value !== 'string') throw new Error('The deadline is required.');
  if (/Z$|[+-]\d{2}:?\d{2}$/u.test(value)) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/u.exec(value);
    if (!match) throw new Error('The deadline is not a valid date and time.');
    localParts(match[1]);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) throw new Error('The deadline is not a valid date and time.');
    return parsed;
  }
  return new Date(zonedDateTimeToUtcIso(value, timeZone));
}

/** Format an instant as a datetime-local value in the game's timezone. */
export function formatZonedDateTimeLocal(date: Date, timeZone: string): string {
  assertValidTimeZone(timeZone);
  const parts = formattedParts(date.valueOf(), timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function validateSchedule(schedule: ScheduleDefinition): string[] {
  const errors: string[] = [];
  for (const [label, value] of [['dayCloses', schedule.dayCloses], ['nightCloses', schedule.nightCloses]] as const) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) errors.push(`${label} must use HH:mm.`);
  }
  if (schedule.activeWeekdays && (schedule.activeWeekdays.length === 0 || schedule.activeWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
    errors.push('Choose at least one valid active weekday.');
  }
  return errors;
}

export async function reconcileDuePhases(db: Database, gameId: string, moderatorId: string | null, now = new Date()): Promise<string[]> {
  const nowIso = now.toISOString();
  const due = await db
    .prepare("SELECT p.id, p.kind, p.closes_at AS closesAt FROM phases p JOIN games g ON g.id = p.game_id WHERE p.game_id = ? AND p.status = 'OPEN' AND p.closes_at <= ? AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN') ORDER BY p.sequence")
    .bind(gameId, nowIso)
    .all<{ id: string; kind: string; closesAt: string }>();
  if (!due.results.length) return [];
  const statements: PreparedStatement[] = [];
  for (const phase of due.results) {
    statements.push(
      db.prepare("UPDATE phases SET status = 'LOCKED', version = version + 1, updated_at = ? WHERE id = ? AND status = 'OPEN'").bind(nowIso, phase.id),
      // Stable IDs make retries and concurrent moderator refreshes harmless.
      db.prepare(`INSERT OR IGNORE INTO game_events (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at)
                  SELECT ?, ?, ?, 'PHASE_DEADLINE_REACHED', ?, ?, ?
                  WHERE EXISTS (SELECT 1 FROM phases p JOIN games g ON g.id = p.game_id
                                WHERE p.id = ? AND p.status = 'LOCKED' AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN'))`)
        .bind(`deadline-${phase.id}`, gameId, phase.id, moderatorId, JSON.stringify({ kind: phase.kind, closesAt: phase.closesAt }), nowIso, phase.id),
      db.prepare(`INSERT OR IGNORE INTO operational_events (id, game_id, severity, source, message, details_json, created_at)
                  SELECT ?, ?, 'INFO', 'SCHEDULER', 'A phase deadline was reached and responses were locked.', ?, ?
                  WHERE EXISTS (SELECT 1 FROM phases p JOIN games g ON g.id = p.game_id
                                WHERE p.id = ? AND p.status = 'LOCKED' AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN'))`)
        .bind(`deadline-${phase.id}`, gameId, JSON.stringify({ phaseId: phase.id, kind: phase.kind, closesAt: phase.closesAt }), nowIso, phase.id),
    );
  }
  await db.batch(statements);
  return due.results.map((phase) => phase.id);
}

/**
 * Sweep every active game for expired open phases. The sweep is safe to run
 * repeatedly: each phase update is conditional and its audit/operational event
 * uses a stable id. A scheduler invocation has no moderator actor, so the
 * nullable audit field is intentionally left empty and the source is recorded
 * as SCHEDULER.
 */
export async function sweepDuePhases(db: Database, now = new Date()): Promise<Array<{ gameId: string; phaseIds: string[] }>> {
  const dueGames = await db
    .prepare(
      `SELECT DISTINCT p.game_id AS gameId
       FROM phases p JOIN games g ON g.id = p.game_id
       WHERE p.status = 'OPEN' AND p.closes_at <= ? AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN')`,
    )
    .bind(now.toISOString())
    .all<{ gameId: string }>();
  const results: Array<{ gameId: string; phaseIds: string[] }> = [];
  for (const game of dueGames.results) {
    const phaseIds = await reconcileDuePhases(db, game.gameId, null, now);
    if (phaseIds.length) results.push({ gameId: game.gameId, phaseIds });
  }
  return results;
}
