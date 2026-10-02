import { chromium, test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type PwaCredential = { email: string; password: string };
type PwaIds = { readerId: string; outsiderId: string; readableBookId: string; restrictedBookId: string };
type PwaTitles = { readableBook: string; restrictedBook: string };
type PwaFixture = {
  origin: 'https://localhost:3443';
  context: BrowserContext;
  /** Unique child of the harness-owned profile root for this test scenario. */
  profilePath: string;
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

/** Signs in a fresh device through the real form; never bypasses recovery barriers. */
export async function loginPwaPage(page: Page, index: number, origin = 'https://localhost:3443'): Promise<string> {
  const credentials = JSON.parse(process.env.PWA_FIXTURE_CREDENTIALS ?? '[]') as PwaCredential[];
  const credential = credentials[index];
  if (!credential) {
    throw new Error('PWA fixture credential is missing');
  }

  await page.goto(`${origin}/login`);
  const recoveryDialog = page.getByTestId('account-exit-dialog');
  if (await recoveryDialog.isVisible().catch(() => false)) {
    throw new Error('PWA login is blocked by an account-exit barrier/recovery dialog; refusing to dismiss it');
  }
  await page.getByLabel('Email Address').fill(credential.email);
  await page.getByLabel('Password', { exact: true }).fill(credential.password);
  let response: Awaited<ReturnType<Page['waitForResponse']>>;
  try {
    [response] = await Promise.all([
      page.waitForResponse((candidate) =>
        new URL(candidate.url()).pathname === '/api/auth/login' && candidate.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: /log in/i }).click({ timeout: 15_000 }),
    ]);
  } catch (error) {
    if (await recoveryDialog.isVisible().catch(() => false)) {
      throw new Error('PWA login submit was blocked by an account-exit barrier/recovery dialog', { cause: error });
    }
    throw new Error('PWA login form did not submit within 15 seconds', { cause: error });
  }
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
  profilePath: async ({}, use, testInfo) => {
    const profileRoot = process.env.PWA_BROWSER_PROFILE;
    if (!profileRoot) {
      throw new Error('Owned PWA browser profile root is required');
    }
    const testIdentity = `${testInfo.testId}-${randomUUID()}`.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
    const profilePath = resolve(profileRoot, 'test-profiles', testIdentity);
    await mkdir(profilePath, { recursive: true, mode: 0o700 });
    await use(profilePath);
  },
  context: async ({ profilePath }, use) => {
    const fingerprint = process.env.PWA_TLS_SPKI;
    if (!fingerprint) {
      throw new Error('Owned PWA TLS SPKI pin is required');
    }
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
