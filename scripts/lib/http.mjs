// Request helpers for the local pilot scripts, which talk to the app the way a browser does.

/** The `name=value` of a cookie the response sets, or '' when it sets none. */
export function readSetCookie(response, name) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=]+=[^;,]+)/u);
  return values.map((value) => value.split(';', 1)[0]).filter((value) => value.startsWith(`${name}=`)).at(-1) ?? '';
}

/**
 * Sends a same-origin request (with the Vercel bypass header when
 * VERCEL_AUTOMATION_BYPASS_SECRET is set) and parses the JSON reply.
 * A body makes it a POST unless a method is given.
 */
export async function sendJson(baseUrl, path, { method, body, cookie } = {}) {
  const headers = { origin: baseUrl };
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { response, status: response.status, data, text };
}
