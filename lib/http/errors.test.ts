import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, routeError } from './errors';
import { RateLimitError } from './rate-limit';

async function read(response: Response) {
  return { status: response.status, body: await response.json() as { ok: boolean; error: string }, retryAfter: response.headers.get('retry-after') };
}

afterEach(() => vi.restoreAllMocks());

describe('route errors', () => {
  it('keeps the status of an HttpError', async () => {
    expect(await read(routeError(new HttpError(403, 'You are not a moderator for this game.'), 'test'))).toMatchObject({
      status: 403,
      body: { ok: false, error: 'You are not a moderator for this game.' },
    });
  });

  it('answers a rate limit with 429 and Retry-After', async () => {
    expect(await read(routeError(new RateLimitError(90), 'test'))).toMatchObject({ status: 429, retryAfter: '90' });
  });

  it('treats an app validation message as a 400 and a bad body as invalid JSON', async () => {
    expect(await read(routeError(new Error('Choose a phase.'), 'test'))).toMatchObject({ status: 400, body: { error: 'Choose a phase.' } });
    expect(await read(routeError(new SyntaxError('Unexpected token'), 'test'))).toMatchObject({ status: 400, body: { error: 'The request body must be valid JSON.' } });
  });

  it('hides database and programming errors behind a generic 500 and logs them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    class LibsqlError extends Error { code = 'SQLITE_CONSTRAINT'; }
    const database = await read(routeError(new LibsqlError('UNIQUE constraint failed: seats.email'), 'test'));
    expect(database.status).toBe(500);
    expect(database.body.error).not.toMatch(/constraint|seats/iu);
    expect((await read(routeError(new TypeError('x.filter is not a function'), 'test'))).status).toBe(500);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
