import { chromium, test as base, expect, type BrowserContext, type Page } from '@playwright/test';
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
   * Uses the real login form so `completeLocalAuth` installs the session before
   * returning. Captures the login response token for raw GraphQL requests.
   */
  loginAs(index: number): Promise<string>;
};

/** Signs in an independent device without inheriting persisted display auth. */
export async function loginPwaPage(page: Page, index: number): Promise<string> {
  const credentials = JSON.parse(process.env.PWA_FIXTURE_CREDENTIALS ?? '[]') as PwaCredential[];
  const credential = credentials[index];
  if (!credential) throw new Error('PWA fixture credential is missing');

  // Stop the old page's bootstrap before clearing its cookie. Preserve private
  // IndexedDB data: account ownership and downloads are not display auth.
  await page.goto('about:blank');
  await page.context().clearCookies({ name: 'transformlit_refresh' });
  await page.goto('https://localhost:3443/offline');
  await page.evaluate(() => localStorage.removeItem('auth-storage'));
  await page.goto('https://localhost:3443/login');
  await page.getByLabel('Email Address').fill(credential.email);
  await page.getByLabel('Password', { exact: true }).fill(credential.password);
  // Do not call /api/auth/refresh separately: the login UI installs the access
  // token itself, and another cookie rotation would race its bootstrap.
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === '/api/auth/login' && candidate.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /log in/i }).click(),
  ]);
  if (!response.ok()) throw new Error(`Fixture login failed with HTTP ${response.status()}`);
  const login = await response.json() as { accessToken?: string };
  if (!login.accessToken) throw new Error('Fixture login returned no access token');
  await expect(page).toHaveURL(/\/feed(?:\?|$)/, { timeout: 15_000 });
  return login.accessToken;
}

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
    await use((index) => loginPwaPage(page, index));
  },
});

export { expect };
