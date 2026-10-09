import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseJsonResponse, requestJson, RequestError, sendJson } from './client';
import { COULD_NOT_REACH } from './plain-error';

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => fetchMock.mockReset());

describe('requestJson', () => {
  test('sends a body as JSON with a POST and returns the answer', async () => {
    fetchMock.mockImplementation(async () => reply(200, { ok: true, id: 'a' }));
    await expect(requestJson<{ id: string }>('/api/x', { body: { name: 'Ana' } })).resolves.toMatchObject({ id: 'a' });
    expect(fetchMock).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"Ana"}',
    });
  });

  test('sends a request without a body as a plain GET, with no content type', async () => {
    fetchMock.mockImplementation(async () => reply(200, { ok: true }));
    await requestJson('/api/x');
    expect(fetchMock).toHaveBeenCalledWith('/api/x', { method: undefined, headers: undefined, body: undefined });
  });

  test('honors an explicit method such as DELETE or PATCH', async () => {
    fetchMock.mockImplementation(async () => reply(200, { ok: true }));
    await requestJson('/api/x/1', { method: 'DELETE' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
    await requestJson('/api/x/1', { method: 'PATCH', body: { role: 'OWNER' } });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: '{"role":"OWNER"}' });
  });

  test("throws the server's message, with the status and body", async () => {
    fetchMock.mockImplementation(async () => reply(409, { error: 'Someone else changed this first.', extra: 1 }));
    const caught = await requestJson('/api/x', { body: {}, fallback: 'Unable to save.' }).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(RequestError);
    expect(caught).toMatchObject({ message: 'Someone else changed this first.', status: 409, body: { extra: 1 } });
  });

  test('joins a list of problems when the server sends errors', async () => {
    fetchMock.mockImplementation(async () => reply(400, { ok: false, errors: ['Name is too short.', 'Pick a timezone.'] }));
    await expect(requestJson('/api/x', { body: {} })).rejects.toThrow('Name is too short. Pick a timezone.');
  });

  test('uses the fallback when the server did not say why', async () => {
    fetchMock.mockImplementation(async () => reply(500, {}));
    await expect(requestJson('/api/x', { fallback: 'Unable to load.' })).rejects.toThrow('Unable to load.');
    fetchMock.mockImplementation(async () => reply(500, {}));
    await expect(requestJson('/api/x')).rejects.toThrow('Request failed.');
  });

  test('reports an answer that is not JSON as one plain sentence, not a parse error', async () => {
    fetchMock.mockImplementation(async () => reply(502, '<html>Bad gateway</html>'));
    await expect(requestJson('/api/x', { fallback: 'Unable to load.' })).rejects.toThrow(COULD_NOT_REACH);
    fetchMock.mockImplementation(async () => reply(200, 'not json'));
    await expect(requestJson('/api/x')).rejects.toThrow(COULD_NOT_REACH);
  });
});

describe('sendJson', () => {
  test('returns the response and body for every status so the page can decide', async () => {
    fetchMock.mockImplementation(async () => reply(429, { error: 'Too many attempts.' }, { 'retry-after': '120' }));
    const { response, data } = await sendJson('/api/login', { body: { pin: '123456' } });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
    expect(data.error).toBe('Too many attempts.');
  });

  test('treats a body that is not JSON as empty', async () => {
    fetchMock.mockImplementation(async () => reply(502, 'nope'));
    const { data } = await sendJson('/api/login', { body: {} });
    expect(data).toEqual({});
  });
});

describe('parseJsonResponse', () => {
  test('returns the body of an ok response and throws for the rest', async () => {
    await expect(parseJsonResponse(reply(200, { rooms: [] }))).resolves.toEqual({ rooms: [] });
    await expect(parseJsonResponse(reply(404, { error: 'Not found.' }))).rejects.toThrow('Not found.');
  });
});
