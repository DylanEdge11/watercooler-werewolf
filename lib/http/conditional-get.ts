/**
 * A GET that sends back the ETag of the data the caller already shows, so the
 * server can answer 304 when nothing changed. Returns null for a 304: the
 * caller keeps what it shows. `cache: 'no-store'` keeps the browser from
 * answering the 304 itself from its own cache, so the caller sees it.
 *
 * The caller keeps the tag next to the data (see `responseEtag`) and updates
 * both together. A response it drops, because a newer request won, then never
 * leaves it holding a tag for data it isn't showing.
 */
export async function conditionalGet(url: string, etag: string | null, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const response = await fetcher(url, { cache: 'no-store', headers: etag ? { 'if-none-match': etag } : undefined });
  if (response.status !== 304) return response;
  // Read the empty body: Chromium reports a response whose body is never read
  // as a cancelled request (net::ERR_ABORTED), which the browser suites count
  // as a failure and which looks like one in the browser's network panel.
  await response.arrayBuffer();
  return null;
}

/** The tag to send next time, or null when the response can't be reused. */
export function responseEtag(response: Response): string | null {
  return response.ok ? response.headers.get('etag') : null;
}
