import { describe, expect, test, vi } from 'vitest';
import { conditionalGet, responseEtag } from './conditional-get';

describe('conditionalGet', () => {
  test('sends the tag it is given, skips the browser cache, and returns null for 304', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 304 }));
    expect(await conditionalGet('/api/player', '"abc"', fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('/api/player', { cache: 'no-store', headers: { 'if-none-match': '"abc"' } });
  });

  test('sends no tag the first time and hands back a changed response', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200, headers: { etag: '"def"' } }));
    const response = await conditionalGet('/api/player', null, fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/player', { cache: 'no-store', headers: undefined });
    expect(response && responseEtag(response)).toBe('"def"');
  });

  test('keeps no tag from an error response', () => {
    expect(responseEtag(new Response('{}', { status: 500, headers: { etag: '"x"' } }))).toBeNull();
    expect(responseEtag(new Response('{}', { status: 200 }))).toBeNull();
  });
});
