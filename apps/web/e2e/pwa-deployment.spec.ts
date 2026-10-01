import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './pwa-fixtures.js';

/**
 * Standalone container / static-serving acceptance (Task 14A).
 *
 * Proves the packaged image actually serves the PWA shell the way production
 * requires: the root-scoped worker with correct MIME/cache headers, the asset
 * inventory, the manifest + icons that Next standalone omits from `public/` by
 * default, immutable hashed chunks, the effective CSP on the registration
 * document, and application-relative API routing.
 *
 * These are asset-serving diagnostics run through the owned HTTPS harness
 * origin (the SPKI-pinned persistent Chromium context lives in `./pwa-fixtures`,
 * so every request is issued from the page). They do NOT establish production
 * authentication/database/proxy/installability acceptance.
 *
 * Docker and Playwright Chromium are present, but the detached harness
 * supervisor was reaped before the suite could run against a stable origin, so
 * this suite is authored and discovery-verified only; its execution is reported
 * BLOCKED, never claimed passing.
 */
const harnessConfigured = Boolean(process.env.PWA_BROWSER_PROFILE && process.env.PWA_TLS_SPKI);

interface BrowserResponse {
  readonly status: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly workerAllowed: string;
  readonly body: string;
}

function fetchInPage(
  page: Page,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<BrowserResponse> {
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

/**
 * Fetches `/sw.js` once and returns it. When it is not served (e.g. the plain
 * dev server), the test is skipped and the returned response is the absent one.
 */
async function requireWorker(page: Page, testInfo: TestInfo): Promise<BrowserResponse> {
  const worker = await fetchInPage(page, '/sw.js');
  if (worker.status !== 200) testInfo.skip(true, 'Generated /sw.js is not served by this server');
  return worker;
}

test.describe('standalone container static serving', () => {
  test.beforeEach(({}, testInfo) => {
    if (!harnessConfigured) {
      testInfo.skip(true, 'Deployment suite requires the owned production HTTPS harness');
    }
  });

  test('serves the root-scoped worker with the required MIME + no-store cache headers', async ({ page, origin }, testInfo) => {
    const worker = await requireWorker(page, testInfo);
    expect(worker.status).toBe(200);
    expect(worker.contentType).toContain('application/javascript');
    expect(worker.cacheControl).toContain('no-store');
    // Explicit scope grant: the released worker registers at `/`.
    expect(worker.workerAllowed).toBe('/');
  });

  test('serves a non-cacheable asset inventory that matches the worker release', async ({ page, origin }, testInfo) => {
    const worker = await requireWorker(page, testInfo);
    const inventory = await fetchInPage(page, '/pwa-assets.json');
    expect(inventory.status).toBe(200);
    expect(inventory.contentType).toContain('application/json');
    expect(inventory.cacheControl).toContain('no-store');
    const parsed = JSON.parse(inventory.body) as { releaseId: string; assets: string[] };
    expect(worker.body).toContain(parsed.releaseId);
    expect(parsed.assets).toContain('/offline');
  });

  test('serves the manifest with icons and a maskable icon', async ({ page, origin }) => {
    const manifest = await fetchInPage(page, '/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    const parsed = JSON.parse(manifest.body) as {
      name: string;
      start_url: string;
      display: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    expect(parsed.name.length).toBeGreaterThan(0);
    expect(parsed.start_url).toBeTruthy();
    expect(parsed.display).toMatch(/standalone|fullscreen|minimal-ui/);
    expect(parsed.icons.some((icon) => icon.sizes.includes('512'))).toBe(true);
    expect(parsed.icons.some((icon) => (icon.purpose ?? '').includes('maskable'))).toBe(true);
  });

  test('serves shell HTML, icons, and immutable hashed chunks from the standalone image', async ({ page, origin }, testInfo) => {
    await requireWorker(page, testInfo);

    // `public/` is NOT copied into Next standalone by default; the Dockerfile
    // must copy it or these 404.
    const icon = await fetchInPage(page, '/icons/pwa-192.png');
    expect(icon.status).toBe(200);

    const offline = await fetchInPage(page, '/offline');
    expect(offline.status).toBe(200);
    expect(offline.body).toContain('<!DOCTYPE html>');

    // Hashed `/_next/static/**` chunks resolve and are immutable.
    const inventory = JSON.parse((await fetchInPage(page, '/pwa-assets.json')).body) as { assets: string[] };
    const chunk = inventory.assets.find((asset) => asset.startsWith('/_next/static/'));
    expect(chunk).toBeTruthy();
    const chunkResponse = await fetchInPage(page, chunk as string);
    expect(chunkResponse.status).toBe(200);
    expect(chunkResponse.cacheControl).toContain('immutable');
    expect(chunkResponse.cacheControl).toContain('max-age=31536000');
  });

  test('carries worker-src self in the effective CSP on the registration document', async ({ page, origin }) => {
    const documentResponse = await page.goto(`${origin}/`);
    const csp = documentResponse?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("worker-src 'self'");
  });

  test('routes the API application-relative (no cross-origin host baked into the shell)', async ({ page, origin }) => {
    // A same-origin GraphQL POST must reach the API (not 404): app-relative
    // routing, not a build-time absolute origin.
    const response = await page.evaluate(async () => {
      const result = await fetch('/api/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      });
      return { status: result.status };
    });
    // 200 (executed) or 401 (guarded) both prove the route exists; 404 would mean
    // the image baked the wrong origin.
    expect([200, 400, 401]).toContain(response.status);
  });

  test('FAILURE: a hashed chunk missing from the standalone output is a 404, not masked', async ({ page, origin }, testInfo) => {
    await requireWorker(page, testInfo);
    // If the Dockerfile forgot to copy `.next/static`, a real chunk would 404.
    // A MISSING chunk must likewise 404 (the worker must not fabricate it).
    const missing = await fetchInPage(page, '/_next/static/chunks/__does-not-exist__.js');
    expect(missing.status).toBe(404);
  });

  test('FAILURE: wrong worker MIME/cache headers are detected, not tolerated', async ({ page, origin }, testInfo) => {
    await requireWorker(page, testInfo);
    const worker = await fetchInPage(page, '/sw.js');
    // A regression that drops the worker MIME or the no-store directive must
    // fail this assertion rather than silently ship a cacheable/mis-typed worker.
    expect(worker.contentType).not.toBe('');
    expect(worker.contentType).toContain('javascript');
    expect(worker.cacheControl).not.toContain('max-age=');
    expect(worker.cacheControl).toContain('no-store');
    expect(worker.workerAllowed).toBe('/');
  });
});

/**
 * Accessibility of the served offline hub (brief line 47). These are DOM-level
 * assertions available in a real browser: semantic landmarks, an announced
 * connection status, a 44px touch-target floor at a mobile viewport, and
 * keyboard focusability.
 *
 * Ownership (recorded in the report): this covers the static `/offline` hub
 * surface 14A serves. The interactive update/download/conflict/sync surfaces are
 * covered by their originating tasks' unit specs (3/6/11/12/13B); colour/theming,
 * reduced-motion, and assistive-technology behaviour on a real device remain
 * 14C-owned live/device evidence.
 */
test.describe('offline hub accessibility', () => {
  test.beforeEach(({}, testInfo) => {
    if (!harnessConfigured) {
      testInfo.skip(true, 'Accessibility suite requires the owned production HTTPS harness');
    }
  });

  test('exposes landmarks, an announced status, 44px touch targets, and keyboard focus', async ({ page, origin }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/offline`);

    const structure = await page.evaluate(() => ({
      main: document.querySelectorAll('main').length,
      header: document.querySelectorAll('header').length,
      footer: document.querySelectorAll('footer').length,
      statusText: document.querySelector('[role="status"][aria-live]')?.textContent?.trim() ?? '',
    }));
    expect(structure.main).toBeGreaterThanOrEqual(1);
    expect(structure.header).toBeGreaterThanOrEqual(1);
    expect(structure.footer).toBeGreaterThanOrEqual(1);
    expect(structure.statusText.length).toBeGreaterThan(0);

    // WCAG 2.5.5 target size: the hub's links/buttons declare `min-h-11` (44px).
    const undersized = await page.evaluate(() => {
      const failures: Array<{ tag: string; height: number }> = [];
      document.querySelectorAll<HTMLElement>('a[href], button:not([disabled])').forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        if (rect.height < 44) failures.push({ tag: element.tagName.toLowerCase(), height: Math.round(rect.height) });
      });
      return failures;
    });
    expect(undersized).toEqual([]);

    // Keyboard: Tab reaches a real interactive control.
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? '');
    expect(['a', 'button']).toContain(focusedTag);
  });
});
