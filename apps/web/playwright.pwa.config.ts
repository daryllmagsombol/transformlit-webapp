import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // `*.pwa.spec.ts` is Task 1B's smoke suite; `pwa-*.spec.ts` covers the Task 3+
  // worker/install/storage/reader acceptance suites, including Task 14A's
  // `pwa-upgrade`/`pwa-deployment` suites.
  testMatch: ['**/*.pwa.spec.ts', '**/pwa-*.spec.ts'],
  fullyParallel: false,
  // The production harness runs the web+API+Postgres containers on the same
  // runner as the browser. Two Playwright workers multiplied peak memory and
  // the runner OOM-killed the harness supervisor (and took the DB process with
  // it) mid-run, surfacing as ERR_CONNECTION_REFUSED on every later test.
  // Serialize to one worker to keep peak memory bounded.
  workers: 1,
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
