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
  const row = await db
    .prepare('SELECT window_started_at AS windowStartedAt, attempts FROM rate_limit_buckets WHERE bucket_key = ? LIMIT 1')
    .bind(bucketKey)
    .first<{ windowStartedAt: string; attempts: number }>();
  const decision = decideRateLimit({
    attempts: Number(row?.attempts ?? 0),
    windowStartedAt: row ? new Date(row.windowStartedAt) : new Date(0),
    now,
    limit,
    windowMs,
  });
  await db
    .prepare(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempts)
       VALUES (?, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = excluded.attempts`,
    )
    .bind(bucketKey, (decision.attempts === 1 ? now : row ? new Date(row.windowStartedAt) : now).toISOString(), decision.attempts)
    .run();
  if (!decision.allowed) {
    throw new RateLimitError(Math.max(1, Math.ceil((decision.resetAt.valueOf() - now.valueOf()) / 1_000)));
  }
}
