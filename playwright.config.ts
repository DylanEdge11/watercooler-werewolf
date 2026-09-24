import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, E2E_REMOTE, E2E_RUN_ID, MODERATOR_EMAIL, MODERATOR_PASSWORD } from './e2e/constants';
import { resolvePlaywrightArtifactPaths } from './e2e/artifact-paths';
import { E2E_REQUEST_HEADERS } from './e2e/transport';
import { proxyTrustArgs } from './e2e/proxy-trust';

// Empty except in Claude Code cloud sessions; see e2e/proxy-trust.ts.
const chromiumLaunchOptions = { args: proxyTrustArgs() };

const artifacts = resolvePlaywrightArtifactPaths(
  E2E_RUN_ID || 'local',
  process.env.E2E_INVOCATION_ID?.trim() || `invocation-${process.pid}-${Date.now()}`,
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: E2E_REMOTE ? 0 : 1,
  outputDir: artifacts.outputDir,
  preserveOutput: 'always',
  reporter: [['list'], ['html', { outputFolder: artifacts.reportDir, open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: E2E_REQUEST_HEADERS,
    trace: E2E_REMOTE ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Fail a blocked click or stalled page load quickly instead of letting it
    // consume the whole test timeout.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'api',
      testMatch: /(?:scripted|randomized)-20-player\.spec\.ts$/u,
    },
    {
      name: 'chromium',
      testMatch: /readiness\/.*\.spec\.ts$/u,
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunchOptions },
    },
    {
      name: 'edge',
      testMatch: /readiness\/browser-smoke\.spec\.ts$/u,
      use: { ...devices['Desktop Chrome'], channel: 'msedge', launchOptions: chromiumLaunchOptions },
    },
    {
      name: 'firefox',
      testMatch: /readiness\/browser-smoke\.spec\.ts$/u,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /readiness\/browser-smoke\.spec\.ts$/u,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: E2E_REMOTE ? undefined : {
    command: 'node scripts/playwright-server.mjs',
    url: `${BASE_URL}/api/moderators/bootstrap`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_MODERATOR_EMAIL: MODERATOR_EMAIL,
      E2E_MODERATOR_PASSWORD: MODERATOR_PASSWORD,
      SITE_ORIGIN: BASE_URL,
      PORT: '3100',
      NODE_ENV: 'test',
    },
  },
});
