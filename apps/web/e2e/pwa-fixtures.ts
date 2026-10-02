import { chromium, test as base, expect, type BrowserContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type PwaCredential = { email: string; password: string };
type PwaIds = { readerId: string; outsiderId: string; readableBookId: string; restrictedBookId: string };
type PwaTitles = { readableBook: string; restrictedBook: string };
type PwaFixture = {
  origin: 'https://localhost:3443';
  context: BrowserContext;
  ids: PwaIds;
  /**
   * Fixture book titles. The "save offline" control exposes its accessible name
   * as `<title>: save offline` (not the book ID), so specs that interact with it
   * must target the rendered title instead of `ids.readableBookId`.
   */
  titles: PwaTitles;
  /**
   * Signs in and establishes the APP session, returning the freshly minted
   * access token. A raw cookie login alone does not install the app's auth
   * store (login returns `{ accessToken, user }` in the BODY and sets the
   * httpOnly refresh cookie), so protected routes would redirect to `/login`.
   * After the cookie login this navigates through `/login` so the app's own
   * `bootstrapAuth()` exchanges the cookie and installs the session, then waits
   * for the app to leave the public login route.
   */
  loginAs(index: number): Promise<string>;
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
  titles: async ({}, use) => {
    const titles = JSON.parse(process.env.PWA_FIXTURE_TITLES ?? '{}') as Partial<PwaTitles>;
    if (!titles.readableBook || !titles.restrictedBook) throw new Error('PWA fixture titles are missing from owner metadata');
    await use(titles as PwaTitles);
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
        if (!response.ok) return { loginStatus: response.status, accessToken: '' };
        const login = await response.json() as { accessToken?: string };
        return { loginStatus: response.status, accessToken: login.accessToken ?? '' };
      }, credential);
      if (result.loginStatus !== 200) throw new Error(`Fixture login failed with HTTP ${result.loginStatus}`);
      if (!result.accessToken) throw new Error('Fixture login returned no access token');
      // The raw cookie login above only sets the httpOnly refresh cookie; it
      // does NOT install the app's auth store. Reloading `/login` makes the
      // app's own `bootstrapAuth()` exchange the cookie and install the session,
      // so protected routes render instead of redirecting to `/login`.
      await page.goto('/login');
      await page.waitForURL(/\/(feed|books)/, { timeout: 30_000 });
      return result.accessToken;
    });
  },
});

export { expect };
