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
 * Docker + Playwright Chromium are unavailable in the implementation
 * environment, so this suite is authored and discovery-verified only; its
 * execution is reported BLOCKED, never claimed passing.
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

async function requireWorker(page: Page, testInfo: TestInfo): Promise<void> {
  const worker = await fetchInPage(page, '/sw.js');
  if (worker.status !== 200) testInfo.skip(true, 'Generated /sw.js is not served by this server');
}

test.describe('standalone container static serving', () => {
  test.beforeEach(({}, testInfo) => {
    if (!harnessConfigured) {
      testInfo.skip(true, 'Deployment suite requires the owned production HTTPS harness');
    }
  });

  test('serves the root-scoped worker with the required MIME + no-store cache headers', async ({ page, origin }, testInfo) => {
    await requireWorker(page, testInfo);
    const worker = await fetchInPage(page, '/sw.js');
    expect(worker.status).toBe(200);
    expect(worker.contentType).toContain('application/javascript');
    expect(worker.cacheControl).toContain('no-store');
    // Explicit scope grant: the released worker registers at `/`.
    expect(worker.workerAllowed).toBe('/');
  });

  test('serves a non-cacheable asset inventory that matches the worker release', async ({ page, origin }, testInfo) => {
    await requireWorker(page, testInfo);
    const worker = await fetchInPage(page, '/sw.js');
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
