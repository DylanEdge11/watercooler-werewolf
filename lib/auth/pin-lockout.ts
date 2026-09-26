import type { Database, PreparedStatement } from '../../db/contracts';

/**
 * A seat refuses sign-in after this many wrong PINs in a row, until a
 * moderator resets its PIN. Sign-in is also limited per device; this caps
 * guessing spread across many devices, which that limit cannot.
 */
export const PIN_LOCKOUT_ATTEMPTS = 10;

export const PIN_LOCKED_MESSAGE = 'This seat is locked after too many wrong PINs. Ask your moderator to reset your PIN.';

/** The counters live in rate_limit_buckets, so no migration is needed. */
export function pinFailureKey(seatId: string): string {
  return `pin-failures:${seatId}`;
}

/** Wrong-PIN counts for these seats; seats with none are absent. */
export async function pinFailureCounts(db: Database, seatIds: string[]): Promise<Map<string, number>> {
  if (!seatIds.length) return new Map();
  const rows = await db
    .prepare(`SELECT bucket_key AS bucketKey, attempts FROM rate_limit_buckets WHERE bucket_key IN (${seatIds.map(() => '?').join(', ')})`)
    .bind(...seatIds.map(pinFailureKey))
    .all<{ bucketKey: string; attempts: number }>();
  return new Map(rows.results.map((row) => [row.bucketKey.slice('pin-failures:'.length), Number(row.attempts)]));
}

export function isPinLocked(failures: number | undefined): boolean {
  return (failures ?? 0) >= PIN_LOCKOUT_ATTEMPTS;
}

export function recordPinFailure(db: Database, seatId: string, now: string): PreparedStatement {
  return db
    .prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempts) VALUES (?, ?, 1)
       ON CONFLICT(bucket_key) DO UPDATE SET attempts = attempts + 1`,
    )
    .bind(pinFailureKey(seatId), now);
}

/** A correct PIN, a new claim, or a moderator's PIN reset starts the count again. */
export function clearPinFailures(db: Database, seatId: string): PreparedStatement {
  return db.prepare('DELETE FROM rate_limit_buckets WHERE bucket_key = ?').bind(pinFailureKey(seatId));
}
