import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // `*.pwa.spec.ts` is Task 1B's smoke suite; `pwa-*.spec.ts` is the convention
  // for the Task 3+ worker/install/storage/reader acceptance suites.
  testMatch: ['**/*.pwa.spec.ts', '**/pwa-*.spec.ts'],
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
