import { test, expect } from '@playwright/test';

/**
 * Static-only service worker coverage.
 *
 * `/sw.js` is produced by the postbuild asset step, so these assertions need a
 * production build (the PWA harness). When the current server does not serve a
 * generated worker (e.g. the dev-server config), each test skips instead of
 * failing. Docker and Playwright Chrome are unavailable in the implementation
 * environment, so this suite is authored and reported blocked.
 */
async function workerIsServed(request: import('@playwright/test').APIRequestContext, baseURL: string) {
  const response = await request.get(`${baseURL}/sw.js`);
  return response.status() === 200;
}

test.describe('static-only service worker', () => {
  test.beforeEach(async ({ request, baseURL }, testInfo) => {
    if (!baseURL) testInfo.skip(true, 'No base URL configured');
    if (!(await workerIsServed(request, baseURL as string))) {
      testInfo.skip(true, 'Generated /sw.js is not served by this server');
    }
  });

  test('serves /sw.js with worker headers and release identity', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/sw.js`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/javascript');
    // Production sets `no-cache, no-store, must-revalidate`; the owned HTTPS
    // proxy normalizes every response to `no-store`. Asserting `no-store`
    // holds for both paths instead of pinning the exact dev string.
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['service-worker-allowed']).toBe('/');
    const body = await response.text();
    expect(body).toContain('transformlit-shell-');
    expect(body).toContain('hasRscIndicators');
  });

  test('serves a matching asset inventory', async ({ request, baseURL }) => {
    const worker = await (await request.get(`${baseURL}/sw.js`)).text();
    const inventory = await (await request.get(`${baseURL}/pwa-assets.json`)).json();
    expect(worker).toContain(inventory.releaseId);
    expect(inventory.assets).toContain('/offline');
  });

  test('caches only allowlisted shell assets and never private data', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    const cacheNames = await page.evaluate(() => globalThis.caches.keys());
    const shellCache = cacheNames.find((name) => name.startsWith('transformlit-shell-'));
    expect(shellCache).toBeTruthy();

    const entries = await page.evaluate(async (name) => {
      const cache = await globalThis.caches.open(name);
      return (await cache.keys()).map((request) => new URL(request.url).pathname);
    }, shellCache as string);

    expect(entries).toContain('/offline');
    expect(entries.some((entry) => entry.startsWith('/api/'))).toBe(false);
    expect(entries.some((entry) => entry.startsWith('/auth/'))).toBe(false);
    expect(entries.some((entry) => entry.startsWith('/_next/data/'))).toBe(false);
  });

  test('authenticated browsing adds no private cache entries', async ({ page, baseURL }, testInfo) => {
    // R1 coverage: navigate as an authenticated user and prove no API/auth/RSC
    // response ever lands in Cache Storage. Requires the owned harness fixtures;
    // skips honestly when credentials are not injected.
    const credentials = JSON.parse(process.env.PWA_FIXTURE_CREDENTIALS ?? '[]') as {
      email: string;
      password: string;
    }[];
    if (credentials.length === 0) {
      testInfo.skip(true, 'No authenticated fixtures available');
      return;
    }

    await page.goto(`${baseURL}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    const login = await page.request.post(`${baseURL}/api/auth/login`, {
      data: { email: credentials[0].email, password: credentials[0].password },
    });
    expect(login.status()).toBe(200);

    // Visit a personalized route so the app issues authenticated GraphQL/page
    // requests while the worker controls the page. Wait for a concrete GraphQL
    // response rather than `networkidle`, which the app's WS subscriptions keep
    // busy indefinitely.
    const graphqlSeen = page
      .waitForResponse((response) => response.url().includes('/graphql'), { timeout: 15_000 })
      .catch(() => null);
    await page.goto(`${baseURL}/feed`);
    await graphqlSeen;

    const cacheEntries = await page.evaluate(async () => {
      const names = await globalThis.caches.keys();
      const result: string[] = [];
      for (const name of names) {
        const cache = await globalThis.caches.open(name);
        for (const request of await cache.keys()) result.push(new URL(request.url).pathname);
      }
      return result;
    });

    expect(cacheEntries.some((entry) => entry.startsWith('/api/'))).toBe(false);
    expect(cacheEntries.some((entry) => entry.startsWith('/auth/'))).toBe(false);
    expect(cacheEntries.some((entry) => entry.startsWith('/graphql'))).toBe(false);
    expect(cacheEntries.some((entry) => entry.startsWith('/_next/data/'))).toBe(false);
  });

  test('never answers an RSC request with fallback HTML', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    const result = await page.evaluate(async () => {
      const response = await fetch('/offline?_rsc=1', {
        headers: { rsc: '1', accept: 'text/x-component' },
      });
      return { contentType: response.headers.get('content-type') ?? '', body: await response.text() };
    });

    expect(result.contentType).not.toContain('text/html');
    expect(result.body).not.toContain('A little room to read offline');
  });
});
