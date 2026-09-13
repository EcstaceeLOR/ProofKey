import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PRODUCTION_WEB_URL;
if (!baseURL)
  throw new Error('Set PRODUCTION_WEB_URL for read-only smoke tests.');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/production-smoke.spec.ts',
  timeout: 120_000,
  retries: 1,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'production-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
