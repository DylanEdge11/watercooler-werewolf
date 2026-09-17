function configuredSiteOrigin(): string | undefined {
  const configured = process.env.SITE_ORIGIN?.trim();
  if (!configured) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('SITE_ORIGIN must be an absolute http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SITE_ORIGIN must use http or https.');
  }
  return parsed.origin;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const expected = configuredSiteOrigin() ?? new URL(request.url).origin;
  if (!origin) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
      throw new Error('Origin header required for browser mutations.');
    }
    return;
  }
  let received: URL;
  try {
    received = new URL(origin);
  } catch {
    throw new Error('Cross-origin mutation rejected.');
  }
  if (received.origin !== expected) {
    throw new Error('Cross-origin mutation rejected.');
  }
}

export function jsonError(message: string, status = 400, headers?: HeadersInit): Response {
  return Response.json({ ok: false, error: message }, { status, headers });
}
