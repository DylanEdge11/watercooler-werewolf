/**
 * Adds "Try again in N minutes." to a rate-limit message, from the response's
 * Retry-After header (seconds). Other responses keep their message as is.
 */
export function withRetryAfter(message: string, response: Pick<Response, 'status' | 'headers'>): string {
  if (response.status !== 429) return message;
  const seconds = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) return message;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${message} Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
