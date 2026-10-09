import { COULD_NOT_REACH } from './plain-error';

/**
 * The browser's side of the JSON API. Every route answers `{ error }` (or `{ errors }` for a list of
 * problems) on a failure, so the pages share one way to send a request and read what came back.
 * An answer that is not JSON did not come from the app (a gateway error page, say), so it is reported
 * as one plain sentence rather than a parse error.
 */

/** A request the server refused or could not complete, with what it said. */
export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>, readonly response?: Response) {
    super(message);
  }
}

export interface JsonRequest {
  /** Defaults to POST when there is a body and GET when there is not. */
  method?: string;
  /** Sent as JSON. Leave it out for a GET or a DELETE. */
  body?: unknown;
  /** The message when the server did not say why it refused. */
  fallback?: string;
}

type Answer<T> = T & { error?: string; errors?: string[] };

function answerMessage(data: { error?: string; errors?: string[] }, fallback: string): string {
  return data.error ?? data.errors?.join(' ') ?? fallback;
}

async function readAnswer<T>(response: Response): Promise<Answer<T> | null> {
  try {
    return (await response.json()) as Answer<T>;
  } catch {
    return null;
  }
}

/** Reads a response as JSON and throws a RequestError carrying the server's message unless it was ok. */
export async function parseJsonResponse<T = Record<string, unknown>>(response: Response, fallback = 'Request failed.'): Promise<T> {
  const data = await readAnswer<T>(response);
  if (!data) throw new RequestError(COULD_NOT_REACH, response.status, {}, response);
  if (!response.ok) throw new RequestError(answerMessage(data, fallback), response.status, data as Record<string, unknown>, response);
  return data;
}

/**
 * Sends a request and returns the response with its JSON body, whatever the status, for pages that treat some
 * statuses specially. A body that is not JSON comes back as an empty object.
 */
export async function sendJson<T = Record<string, unknown>>(url: string, { method, body }: JsonRequest = {}): Promise<{ response: Response; data: Answer<T> }> {
  const hasBody = body !== undefined;
  const response = await fetch(url, {
    method: method ?? (hasBody ? 'POST' : undefined),
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  return { response, data: (await readAnswer<T>(response)) ?? ({} as Answer<T>) };
}

/** Sends a request and returns its JSON body, or throws a RequestError carrying the server's message. */
export async function requestJson<T = Record<string, unknown>>(url: string, options: JsonRequest = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? (options.body !== undefined ? 'POST' : undefined),
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return parseJsonResponse<T>(response, options.fallback);
}
