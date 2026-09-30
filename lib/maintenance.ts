import type { Database } from '../db/contracts';

/** Rate-limit windows are at most an hour, so a bucket untouched for a day is stale. */
const STALE_BUCKET_MS = 24 * 60 * 60_000;

/**
 * Deletes rows nothing will read again: expired moderator, player, and
 * spectator sessions, and stale rate-limit buckets. PIN lockout counters are kept; they
 * clear only on a correct PIN, a new claim, or a moderator's PIN reset.
 */
export async function purgeExpiredRows(db: Database, now = new Date()): Promise<{ moderatorSessions: number; seatSessions: number; spectatorSessions: number; rateLimitBuckets: number }> {
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.valueOf() - STALE_BUCKET_MS).toISOString();
  const results = await db.batch([
    db.prepare('DELETE FROM moderator_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare('DELETE FROM seat_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare('DELETE FROM spectator_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key NOT LIKE 'pin-failures:%' AND window_started_at < ?").bind(staleBefore),
  ]);
  const count = (index: number) => Number((results[index] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
  return { moderatorSessions: count(0), seatSessions: count(1), spectatorSessions: count(2), rateLimitBuckets: count(3) };
}
