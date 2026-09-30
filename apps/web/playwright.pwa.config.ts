import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pwa.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'https://localhost:3443',
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
  },
});
