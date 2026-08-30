export interface RateLimitDecision {
  allowed: boolean;
  attempts: number;
  resetAt: Date;
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many attempts. Please wait before trying again.');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function decideRateLimit(input: {
  attempts: number;
  windowStartedAt: Date;
  now: Date;
  limit: number;
  windowMs: number;
}): RateLimitDecision {
  const windowExpired = input.now.valueOf() - input.windowStartedAt.valueOf() >= input.windowMs;
  const attempts = windowExpired ? 1 : input.attempts + 1;
  const resetAt = windowExpired
    ? new Date(input.now.valueOf() + input.windowMs)
    : new Date(input.windowStartedAt.valueOf() + input.windowMs);
  return { allowed: attempts <= input.limit, attempts, resetAt };
}

export function requestRateLimitKey(request: Request, subject: string): string {
  const forwarded = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `${subject}:${forwarded || 'unknown-client'}`;
}

export async function enforceRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const { getD1 } = await import('../../db');
  const db = getD1();
  const now = new Date();
  const nowIso = now.toISOString();
  // The insert, increment/reset, and read execute in one D1 batch. This keeps
  // simultaneous requests from overwriting each other's attempt count.
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO rate_limit_buckets (bucket_key, window_started_at, attempts)
         VALUES (?, ?, 0)`,
      )
      .bind(bucketKey, nowIso),
    db
      .prepare(
        `UPDATE rate_limit_buckets
         SET window_started_at = CASE
               WHEN (julianday(?) - julianday(window_started_at)) * 86400000 >= ? THEN ?
               ELSE window_started_at
             END,
             attempts = CASE
               WHEN (julianday(?) - julianday(window_started_at)) * 86400000 >= ? THEN 1
               ELSE attempts + 1
             END
         WHERE bucket_key = ?`,
      )
      .bind(nowIso, windowMs, nowIso, nowIso, windowMs, bucketKey),
    db
      .prepare('SELECT window_started_at AS windowStartedAt, attempts FROM rate_limit_buckets WHERE bucket_key = ? LIMIT 1')
      .bind(bucketKey),
  ]);
  const row = (results[2] as D1Result<{ windowStartedAt: string; attempts: number }>).results[0];
  if (!row) throw new Error('Rate-limit bucket could not be updated.');
  const resetAt = new Date(new Date(row.windowStartedAt).valueOf() + windowMs);
  if (Number(row.attempts) > limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((resetAt.valueOf() - now.valueOf()) / 1_000)));
  }
}
