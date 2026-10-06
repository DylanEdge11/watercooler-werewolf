// Request helpers for the local pilot scripts, which talk to the app the way a browser does.
import { confirmRemoteHost } from './target-database.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The pilot helpers create a disposable game. A local run needs nothing. A remote run needs
 * PILOT_ALLOW_REMOTE=yes, https (the moderator password travels with the request), and the operator
 * naming the host (--confirm-host=<host>, CONFIRM_HOST, or typing it at the prompt).
 * @param {string} baseUrl
 * @param {{ env?: Record<string, string | undefined>, log?: (message: string) => void, argv?: string[], interactive?: boolean, prompt?: (question: string) => Promise<string> }} [options]
 */
export async function assertPilotTarget(baseUrl, { env = process.env, log = console.log, ...options } = {}) {
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('PILOT_BASE_URL must be an http:// or https:// preview URL.');
  }
  log(`Target app: ${parsed.origin}.`);
  if (LOCAL_HOSTS.has(parsed.hostname)) return { remote: false, host: parsed.hostname };
  if (env.PILOT_ALLOW_REMOTE !== 'yes') {
    throw new Error('PILOT_BASE_URL is not local. Set PILOT_ALLOW_REMOTE=yes only for an explicitly approved fictional staging environment; never point this helper at production.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('PILOT_BASE_URL must use https:// for a remote host, because the moderator password is sent with the request.');
  }
  await confirmRemoteHost({ label: 'app', host: parsed.hostname, env, ...options });
  return { remote: true, host: parsed.hostname };
}

let warnedAboutBypass = false;

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
  if (bypassSecret) {
    // The bypass secret only ever goes to a Vercel preview address, never to a mistyped host.
    if (new URL(baseUrl).hostname.endsWith('.vercel.app')) {
      headers['x-vercel-protection-bypass'] = bypassSecret;
    } else if (!warnedAboutBypass && !LOCAL_HOSTS.has(new URL(baseUrl).hostname)) {
      warnedAboutBypass = true;
      console.warn('VERCEL_AUTOMATION_BYPASS_SECRET was not sent: the target is not a *.vercel.app address.');
    }
  }
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
