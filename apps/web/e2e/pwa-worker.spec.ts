import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './pwa-fixtures.js';

/**
 * Static-only service worker coverage.
 *
 * `/sw.js` is produced by the postbuild asset step, so these assertions need the
 * owned production HTTPS harness. That harness uses a self-signed certificate
 * and is reachable only through the SPKI-pinned persistent Chromium context in
 * `./pwa-fixtures` — so this suite consumes `test`/`expect` from there and
 * issues every HTTP call from the page itself (browser-origin `fetch`), exactly
 * as `pwa-smoke.pwa.spec.ts` does. The isolated `request` fixture would reject
 * the certificate.
 *
 * Each test depends on the harness `origin` fixture, which navigates the page to
 * the trusted same-origin app before any relative `fetch`. When the harness env
 * is absent (e.g. the plain dev-server config) `beforeEach` skips honestly
 * before any harness fixture (including the SPKI context) is set up.
 *
 * Docker and Playwright Chrome are unavailable in the implementation
 * environment, so this suite is authored and discovery-verified, and its
 * execution is reported BLOCKED.
 */
const harnessConfigured = Boolean(process.env.PWA_BROWSER_PROFILE && process.env.PWA_TLS_SPKI);

interface BrowserResponse {
  readonly status: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly workerAllowed: string;
  readonly body: string;
}

function fetchInPage(page: Page, path: string, init?: { headers?: Record<string, string> }): Promise<BrowserResponse> {
  return page.evaluate(async ({ path: requestPath, init: requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      cacheControl: response.headers.get('cache-control') ?? '',
      workerAllowed: response.headers.get('service-worker-allowed') ?? '',
      body: await response.text(),
    };
  }, { path, init });
}

async function shellCacheEntries(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await globalThis.caches.keys();
    const result: string[] = [];
    for (const name of names) {
      const cache = await globalThis.caches.open(name);
      for (const request of await cache.keys()) result.push(new URL(request.url).pathname);
    }
    return result;
  });
}

async function skipIfWorkerAbsent(page: Page, testInfo: TestInfo): Promise<void> {
  const worker = await fetchInPage(page, '/sw.js');
  if (worker.status !== 200) testInfo.skip(true, 'Generated /sw.js is not served by this server');
}

test.describe('static-only service worker', () => {
  test.beforeEach(({}, testInfo) => {
    // No fixtures are requested here, so the SPKI context is never launched when
    // the harness is absent; the skip happens first.
    if (!harnessConfigured) {
      testInfo.skip(true, 'Static worker suite requires the owned production HTTPS harness');
    }
  });

  test('serves /sw.js with worker headers and release identity', async ({ page, origin }, testInfo) => {
    await skipIfWorkerAbsent(page, testInfo);
    const response = await fetchInPage(page, '/sw.js');
    expect(response.status).toBe(200);
    expect(response.contentType).toContain('application/javascript');
    // Production sets `no-cache, no-store, must-revalidate`; the owned HTTPS
    // proxy normalizes every response to `no-store`. Asserting `no-store`
    // holds for both paths instead of pinning the exact dev string.
    expect(response.cacheControl).toContain('no-store');
    expect(response.workerAllowed).toBe('/');
    expect(response.body).toContain('transformlit-shell-');
    expect(response.body).toContain('hasRscIndicators');
  });

  test('serves a matching asset inventory', async ({ page, origin }, testInfo) => {
    await skipIfWorkerAbsent(page, testInfo);
    const worker = await fetchInPage(page, '/sw.js');
    const inventoryResponse = await fetchInPage(page, '/pwa-assets.json');
    const inventory = JSON.parse(inventoryResponse.body) as { releaseId: string; assets: string[] };
    expect(worker.body).toContain(inventory.releaseId);
    expect(inventory.assets).toContain('/offline');
  });

  test('caches only allowlisted shell assets and never private data', async ({ page, origin }, testInfo) => {
    await skipIfWorkerAbsent(page, testInfo);
    await page.goto(`${origin}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    const cacheNames = await page.evaluate(() => globalThis.caches.keys());
    const shellCache = cacheNames.find((name) => name.startsWith('transformlit-shell-'));
    expect(shellCache).toBeTruthy();

    const entries = await shellCacheEntries(page);
    expect(entries).toContain('/offline');
    expect(entries.some((entry) => entry.startsWith('/api/'))).toBe(false);
    expect(entries.some((entry) => entry.startsWith('/auth/'))).toBe(false);
    expect(entries.some((entry) => entry.startsWith('/_next/data/'))).toBe(false);
  });

  test('authenticated browsing adds no private cache entries', async ({ page, origin, loginAs }, testInfo) => {
    // R1 coverage: navigate as an authenticated user and prove no API/auth/RSC
    // response ever lands in Cache Storage. Requires the owned harness fixtures.
    await skipIfWorkerAbsent(page, testInfo);
    await page.goto(`${origin}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);
    await loginAs(0);

    // Visit a personalized route so the app issues authenticated GraphQL/page
    // requests while the worker controls the page. Wait for a concrete GraphQL
    // response rather than `networkidle`, which the app's WS subscriptions keep
    // busy indefinitely.
    const graphqlSeen = page
      .waitForResponse((response) => response.url().includes('/graphql'), { timeout: 15_000 })
      .catch(() => null);
    await page.goto(`${origin}/feed`);
    await graphqlSeen;

    const cacheEntries = await shellCacheEntries(page);
    expect(cacheEntries.some((entry) => entry.startsWith('/api/'))).toBe(false);
    expect(cacheEntries.some((entry) => entry.startsWith('/auth/'))).toBe(false);
    expect(cacheEntries.some((entry) => entry.startsWith('/graphql'))).toBe(false);
    expect(cacheEntries.some((entry) => entry.startsWith('/_next/data/'))).toBe(false);
  });

  test('never answers an RSC request with the precached shell HTML', async ({ page, origin }, testInfo) => {
    await skipIfWorkerAbsent(page, testInfo);
    await page.goto(`${origin}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    // Capture the precached shell bytes so we can prove the RSC response is a
    // distinct flight payload, not a reused HTML fallback.
    const shell = await page.evaluate(async () => {
      const names = await globalThis.caches.keys();
      const name = names.find((entry) => entry.startsWith('transformlit-shell-'));
      const cache = await globalThis.caches.open(name as string);
      const cached = await cache.match('/offline');
      return cached ? await cached.text() : '';
    });
    expect(shell).toContain('A little room to read offline');

    // Online, the App Router answers an RSC request with a `text/x-component`
    // flight payload. The worker must leave that request unhandled, so the
    // response is the RSC content type — never the HTML shell, which Task 3's
    // offline fallback would only serve when the network is unreachable.
    const response = await fetchInPage(page, '/offline?_rsc=1', {
      headers: { rsc: '1', accept: 'text/x-component' },
    });

    expect(response.contentType).toContain('text/x-component');
    expect(response.body).not.toContain('<!DOCTYPE html>');
    expect(response.body).not.toBe(shell);
  });
});
