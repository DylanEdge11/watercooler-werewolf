import type { Database } from '../db/contracts';

/** Rate-limit windows are at most an hour, so a bucket untouched for a day is stale. */
const STALE_BUCKET_MS = 24 * 60 * 60_000;
/** The console counts late attempts for the last 24 hours only; a month of them is kept for review and backups. */
const LATE_ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * Deletes rows nothing will read again: expired moderator, player, and
 * spectator sessions, stale rate-limit buckets, and late-attempt log rows older than
 * 30 days. PIN lockout counters are kept; they clear only on a correct PIN, a new claim,
 * or a moderator's PIN reset. Every other event-log row is kept: those are the audit trail.
 */
export async function purgeExpiredRows(db: Database, now = new Date()): Promise<{ moderatorSessions: number; seatSessions: number; spectatorSessions: number; rateLimitBuckets: number; lateAttemptEvents: number }> {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.valueOf() - STALE_BUCKET_MS).toISOString();
  const lateAttemptsBefore = new Date(now.valueOf() - LATE_ATTEMPT_RETENTION_MS).toISOString();
  const results = await db.batch([
    db.prepare('DELETE FROM moderator_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare('DELETE FROM seat_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare('DELETE FROM spectator_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key NOT LIKE 'pin-failures:%' AND window_started_at < ?").bind(staleBefore),
    // Late attempts are always logged as WARNING. Naming the severity lets this use idx_operational_events_recent
    // (severity, created_at) instead of scanning every game's events on each scheduler call.
    db.prepare("DELETE FROM operational_events WHERE severity = 'WARNING' AND source = 'DEADLINE_MONITOR' AND created_at < ?").bind(lateAttemptsBefore),
  ]);
  const count = (index: number) => Number((results[index] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
  return { moderatorSessions: count(0), seatSessions: count(1), spectatorSessions: count(2), rateLimitBuckets: count(3), lateAttemptEvents: count(4) };
}
