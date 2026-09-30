import { chromium, test as base, expect, type BrowserContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type PwaCredential = { email: string; password: string };
type PwaIds = { readerId: string; outsiderId: string; readableBookId: string; restrictedBookId: string };
type PwaFixture = {
  origin: 'https://localhost:3443';
  context: BrowserContext;
  ids: PwaIds;
  loginAs(index: number): Promise<void>;
};

export const test = base.extend<PwaFixture>({
  origin: async ({ baseURL, page }, use) => {
    if (baseURL !== 'https://localhost:3443') throw new Error('PWA E2E requires the owned HTTPS harness origin');
    await page.goto(`${baseURL}/login`);
    const secure = await page.evaluate(() => globalThis.isSecureContext);
    if (!secure) throw new Error('PWA origin is not a secure browser context');
    await use(baseURL);
  },
  context: async ({}, use) => {
    const profile = process.env.PWA_BROWSER_PROFILE;
    const fingerprint = process.env.PWA_TLS_SPKI;
    if (!profile || !fingerprint) throw new Error('Owned PWA browser profile and TLS SPKI pin are required');
    const profilePath = resolve(profile);
    await mkdir(profilePath, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      ignoreHTTPSErrors: false,
      args: [`--ignore-certificate-errors-spki-list=${fingerprint}`],
    });
    await use(context);
    await context.close();
  },
  ids: async ({}, use) => {
    const ids = JSON.parse(process.env.PWA_FIXTURE_IDS ?? '{}') as Partial<PwaIds>;
    if (!ids.readerId || !ids.outsiderId || !ids.readableBookId || !ids.restrictedBookId) throw new Error('PWA fixture IDs are missing from owner metadata');
    await use(ids as PwaIds);
  },
  loginAs: async ({ page }, use) => {
    const credentials = JSON.parse(process.env.PWA_FIXTURE_CREDENTIALS ?? '[]') as PwaCredential[];
    await use(async (index) => {
      const credential = credentials[index];
      if (!credential) throw new Error('PWA fixture credential is missing');
      const result = await page.evaluate(async ({ email, password }) => {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) return { loginStatus: response.status, refreshStatus: 0 };
        const refresh = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        return { loginStatus: response.status, refreshStatus: refresh.status };
      }, credential);
      if (result.loginStatus !== 200) throw new Error(`Fixture login failed with HTTP ${result.loginStatus}`);
      if (result.refreshStatus !== 200) throw new Error(`Fixture refresh failed with HTTP ${result.refreshStatus}`);
    });
  },
});

export { expect };
