import { request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test';
import { BASE_ORIGIN, BASE_URL, E2E_REMOTE, VERCEL_AUTOMATION_BYPASS_SECRET } from './constants';

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
  }
  return context;
}

export function newRequestContext(options: APIRequestContextOptions = {}): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    ...options,
    baseURL: BASE_URL,
    extraHTTPHeaders: { ...E2E_REQUEST_HEADERS, ...options.extraHTTPHeaders },
  });
}
