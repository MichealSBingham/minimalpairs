import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: '../qa/e2e',
  timeout: 240_000,
  expect: { timeout: 25_000 },
  workers: 2,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../qa/e2e-results.json' }]],
  use: {
    baseURL: process.env.MINIMALPAIRS_TEST_URL || 'https://minimalpairs.web.app',
    channel: 'chrome',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: { cookies: [], origins: [] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
});
