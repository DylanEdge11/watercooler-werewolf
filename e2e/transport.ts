import { request as playwrightRequest, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test';
import { BASE_ORIGIN, BASE_URL, E2E_REMOTE, VERCEL_AUTOMATION_BYPASS_SECRET } from './constants';
import { behindCloudProxy, isProxyGatewayError } from './proxy-trust';

export const E2E_REQUEST_HEADERS: Record<string, string> = {
  Origin: BASE_ORIGIN,
  ...(VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
};

const E2E_BROWSER_HEADERS: Record<string, string> = {
  ...(VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
};

type APIRequestContextOptions = Parameters<typeof playwrightRequest.newContext>[0];

export function browserContextOptions(options: BrowserContextOptions = {}): BrowserContextOptions {
  return {
    ...options,
    baseURL: BASE_URL,
    // Do not force Origin onto browser navigations. Chromium may preflight
    // those navigation requests; programmatic API requests add Origin below.
    extraHTTPHeaders: { ...E2E_BROWSER_HEADERS, ...options.extraHTTPHeaders },
  };
}

export async function newBrowserContext(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext(browserContextOptions(options));
  if (E2E_REMOTE) {
    // Vercel injects its feedback toolbar into Preview pages. Tests never use it,
    // and some networks block vercel.live, which would show up as failed requests.
    await context.route(/^https:\/\/vercel\.live\//u, (route) => route.fulfill({ status: 204, body: '' }));
    if (behindCloudProxy()) await retryCloudProxyGatewayErrors(context);
  }
  return context;
}

const PROXY_RETRY_ATTEMPTS = 3;

/**
 * Hosted runs from a Claude Code cloud session only: re-send a read that the
 * session's proxy failed on its own (see isProxyGatewayError). Writes are never
 * retried, and any response Vercel actually served, including a 5xx, reaches
 * the page unchanged. Each retry is logged so reports show the count.
 */
async function retryCloudProxyGatewayErrors(context: BrowserContext): Promise<void> {
  await context.route((url) => url.origin === BASE_ORIGIN, async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) {
      await route.fallback();
      return;
    }
    const path = new URL(request.url()).pathname;
    for (let attempt = 1; ; attempt += 1) {
      let response: APIResponse;
      try {
        // Hand redirects back to the page so its URL follows them as usual.
        response = await route.fetch({ maxRedirects: 0 });
      } catch (error) {
        // The proxy dropped the connection, or the page or context closed.
        if (attempt >= PROXY_RETRY_ATTEMPTS) {
          await route.abort('failed').catch(() => undefined);
          return;
        }
        console.warn(`[cloud-proxy] retrying ${request.method()} ${path} after ${error instanceof Error ? error.message.split('\n')[0] : 'a network error'} (attempt ${attempt})`);
        continue;
      }
      if (attempt >= PROXY_RETRY_ATTEMPTS || !isProxyGatewayError(response.status(), response.headers())) {
        await route.fulfill({ response }).catch(() => undefined);
        return;
      }
      console.warn(`[cloud-proxy] retrying ${request.method()} ${path} after proxy ${response.status()} (attempt ${attempt})`);
    }
  });
}

export function newRequestContext(options: APIRequestContextOptions = {}): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    ...options,
    baseURL: BASE_URL,
    extraHTTPHeaders: { ...E2E_REQUEST_HEADERS, ...options.extraHTTPHeaders },
  });
}
