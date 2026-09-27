import { sha256 } from '../auth/crypto';

/**
 * Sends `payload` as JSON with an ETag (a hash of the body). When the
 * request's If-None-Match already names that tag, it answers 304 with no body,
 * so a poll that finds nothing new costs a few bytes and no re-render.
 */
export async function respondJsonWithEtag(request: Request, payload: unknown, init: ResponseInit = {}): Promise<Response> {
  const body = JSON.stringify(payload);
  const etag = `"${await sha256(body)}"`;
  const headers = new Headers(init.headers);
  headers.set('etag', etag);
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  headers.set('content-type', 'application/json');
  return new Response(body, { ...init, headers });
}
