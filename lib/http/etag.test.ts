import { describe, expect, it, vi } from 'vitest';
import { conditionalGet, responseEtag } from './conditional-get';
import { respondJsonWithEtag } from './etag';

const request = (etag?: string) => new Request('http://localhost:3000/api/player', { headers: etag ? { 'if-none-match': etag } : {} });

describe('conditional responses', () => {
  it('answers 304 with no body when the payload has not changed', async () => {
    const first = await respondJsonWithEtag(request(), { ok: true, n: 1 });
    const etag = first.headers.get('etag')!;
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, n: 1 });
    const same = await respondJsonWithEtag(request(etag), { ok: true, n: 1 });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe('');
    const changed = await respondJsonWithEtag(request(etag), { ok: true, n: 2 });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  it('a client that sends back the tag of what it shows gets null until the payload changes', async () => {
    let payload = { n: 1 };
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      respondJsonWithEtag(new Request(String(url), { headers: init?.headers }), payload));
    const url = 'http://localhost:3000/api/player';
    const first = (await conditionalGet(url, null, fetcher as typeof fetch))!;
    expect(await first.json()).toEqual({ n: 1 });
    const etag = responseEtag(first);
    expect(await conditionalGet(url, etag, fetcher as typeof fetch)).toBeNull();
    payload = { n: 2 };
    expect(await (await conditionalGet(url, etag, fetcher as typeof fetch))!.json()).toEqual({ n: 2 });
  });
});
