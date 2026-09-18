import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, MODERATOR_EMAIL, MODERATOR_PASSWORD } from './e2e/constants';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 1,
  outputDir: 'test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'api',
      testMatch: /(?:scripted|randomized)-20-player\.spec\.ts$/u,
    },
    {
      name: 'chromium',
      testMatch: /readiness\/.*\.spec\.ts$/u,
      use: { ...devices['Desktop Chrome'] },
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
  webServer: {
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
