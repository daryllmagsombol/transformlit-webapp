import { defineConfig, devices } from '@playwright/test';

const browserProfile = process.env.PWA_BROWSER_PROFILE;
if (!browserProfile) throw new Error('PWA_BROWSER_PROFILE must point at the owned repository-local trust profile');

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
    launchOptions: { args: [`--user-data-dir=${browserProfile}`] },
  },
});
