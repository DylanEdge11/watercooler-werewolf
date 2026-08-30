export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const requestUrl = new URL(request.url);
  if (new URL(origin).host !== requestUrl.host) {
    throw new Error('Cross-origin mutation rejected.');
  }
}

export function jsonError(message: string, status = 400, headers?: HeadersInit): Response {
  return Response.json({ ok: false, error: message }, { status, headers });
}
