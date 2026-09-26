import { RateLimitError } from './rate-limit';

export function jsonError(message: string, status = 400, headers?: HeadersInit): Response {
  return Response.json({ ok: false, error: message }, { status, headers });
}

/** An error whose message is safe to show and whose status is known. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const GENERIC_SERVER_ERROR = 'Something went wrong on the server. Please try again in a moment.';

/**
 * The one way routes turn a thrown error into a response.
 *
 * - HttpError and RateLimitError keep their status (and Retry-After).
 * - A request body that is not JSON is a 400.
 * - A plain `Error` is a validation message written by this app, so it is a 400 with its text.
 * - Anything else (a database or library error, a TypeError from a bug) is logged and answered
 *   with a generic 500, so internal details never reach the browser.
 */
export function routeError(error: unknown, context: string): Response {
  if (error instanceof RateLimitError) {
    return jsonError(error.message, 429, { 'retry-after': String(error.retryAfterSeconds) });
  }
  if (error instanceof HttpError) return jsonError(error.message, error.status);
  if (error instanceof SyntaxError) return jsonError('The request body must be valid JSON.', 400);
  if (error instanceof Error && error.constructor === Error) return jsonError(error.message, 400);
  console.error(context, error);
  return jsonError(GENERIC_SERVER_ERROR, 500);
}
