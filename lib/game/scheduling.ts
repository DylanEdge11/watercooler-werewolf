export interface ScheduleDefinition {
  dayCloses: string;
  nightCloses: string;
  activeWeekdays?: number[];
}

function localParts(value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/u.exec(value);
  if (!match) throw new Error('Date and time must use YYYY-MM-DDTHH:mm.');
  const [, year, month, day, hour, minute, second = '0'] = match;
  return { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) };
}

function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), hour, Number(values.minute), Number(values.second)) - instant;
}

/** Convert a datetime-local value in the game's IANA zone to an absolute UTC ISO. */
export function zonedDateTimeToUtcIso(value: string, timeZone: string): string {
  new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  const parts = localParts(value);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = localAsUtc - offsetAt(localAsUtc, timeZone);
  instant = localAsUtc - offsetAt(instant, timeZone);
  return new Date(instant).toISOString();
}

export function parseScheduledDate(value: string, timeZone: string): Date {
  if (!value || typeof value !== 'string') throw new Error('The deadline is required.');
  if (/Z$|[+-]\d{2}:?\d{2}$/u.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) throw new Error('The deadline is not a valid date and time.');
    return parsed;
  }
  return new Date(zonedDateTimeToUtcIso(value, timeZone));
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

export async function reconcileDuePhases(db: D1Database, gameId: string, moderatorId: string, now = new Date()): Promise<string[]> {
  const nowIso = now.toISOString();
  const due = await db
    .prepare("SELECT p.id, p.kind, p.closes_at AS closesAt FROM phases p JOIN games g ON g.id = p.game_id WHERE p.game_id = ? AND p.status = 'OPEN' AND p.closes_at <= ? AND g.status IN ('ACTIVE', 'FINAL_SHOWDOWN') ORDER BY p.sequence")
    .bind(gameId, nowIso)
    .all<{ id: string; kind: string; closesAt: string }>();
  if (!due.results.length) return [];
  const statements: D1PreparedStatement[] = [];
  for (const phase of due.results) {
    statements.push(
      db.prepare("UPDATE phases SET status = 'LOCKED', version = version + 1, updated_at = ? WHERE id = ? AND status = 'OPEN'").bind(nowIso, phase.id),
      // Stable IDs make retries and concurrent moderator refreshes harmless.
      db.prepare(`INSERT OR IGNORE INTO game_events (id, game_id, phase_id, event_type, actor_moderator_id, payload_json, created_at) VALUES (?, ?, ?, 'PHASE_DEADLINE_REACHED', ?, ?, ?)`).bind(`deadline-${phase.id}`, gameId, phase.id, moderatorId, JSON.stringify({ kind: phase.kind, closesAt: phase.closesAt }), nowIso),
      db.prepare(`INSERT OR IGNORE INTO operational_events (id, game_id, severity, source, message, details_json, created_at) VALUES (?, ?, 'INFO', 'SCHEDULER', 'A phase deadline was reached and responses were locked.', ?, ?)`).bind(`deadline-${phase.id}`, gameId, JSON.stringify({ phaseId: phase.id, kind: phase.kind, closesAt: phase.closesAt }), nowIso),
    );
  }
  await db.batch(statements);
  return due.results.map((phase) => phase.id);
}
