import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // `*.pwa.spec.ts` is Task 1B's smoke suite; `pwa-*.spec.ts` is the convention
  // for the Task 3+ worker/install/storage/reader acceptance suites.
  // `*.pwa.spec.ts` is Task 1B's smoke suite; `pwa-*.spec.ts` covers the Task 3+
  // worker/install/storage/reader acceptance suites, including Task 14A's
  // `pwa-upgrade`/`pwa-deployment` suites.
  testMatch: ['**/*.pwa.spec.ts', '**/pwa-*.spec.ts'],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // Upgrade/rollback flows wait on service-worker activation and IndexedDB
  // version-change events, which exceed the 30s default under the harness.
  timeout: 60_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'https://localhost:3443',
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
  },
});
