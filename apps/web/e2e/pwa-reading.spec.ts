import { chromium } from '@playwright/test';
import { test, expect } from './pwa-fixtures.js';

/**
 * Real-browser cold-offline reading acceptance (Task 7).
 *
 * Flow:
 *  1. Sign in and download a book through the real download manager.
 *  2. Close the browser process entirely and relaunch from the same
 *     repository-local profile.
 *  3. Disable connectivity BEFORE navigating to `/offline`.
 *  4. Open the saved book and assert a decoded frame, matching page/text layer
 *     and content version, zero CSP violations, and Blob URL cleanup.
 *
 * The harness Chromium binary is not installed in the implementation
 * environment, so this suite is authored and discovery-verified only; execution
 * is reported BLOCKED rather than claimed passing.
 */
const harnessConfigured = Boolean(process.env.PWA_BROWSER_PROFILE && process.env.PWA_TLS_SPKI);

test.describe('repository-backed offline reading', () => {
  test.beforeEach(({}, testInfo) => {
    // No fixtures are requested before this guard, so the SPKI context is never
    // launched when the harness is absent.
    if (!harnessConfigured) {
      testInfo.skip(true, 'Offline reading suite requires the owned production HTTPS harness');
    }
  });

  test('opens a downloaded book after a cold offline restart with no CSP violations', async ({
    page,
    origin,
    loginAs,
    ids,
    titles,
    profilePath,
  }) => {
    await loginAs(0);

    // 1. Download one authorized book through the real UI.
    await page.goto(`${origin}/books`);
    // The save control's accessible name is the book TITLE, not its ID.
    const saveButton = page.getByRole('button', { name: `${titles.readableBook}: save offline` });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.getByText('Saved offline', { exact: true })).toBeVisible({ timeout: 30_000 });

    // Capture the version the offline reader must render.
    const readyVersion = await readActiveVersion(page, ids.readerId, ids.readableBookId);
    expect(readyVersion).toBeGreaterThan(0);

    // 2. Close the whole browser process and relaunch from the same profile.
    const fingerprint = process.env.PWA_TLS_SPKI as string;
    await page.context().close();
    const relaunched = await chromium.launchPersistentContext(profilePath, {
      headless: true,
      ignoreHTTPSErrors: false,
      args: [`--ignore-certificate-errors-spki-list=${fingerprint}`],
    });
    const coldPage = await relaunched.newPage();

    const cspViolations: string[] = [];
    coldPage.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    await coldPage.exposeFunction('__recordBlobUrl', (url: string) => createdUrls.push(url));
    await coldPage.exposeFunction('__recordRevokedUrl', (url: string) => revokedUrls.push(url));
    await coldPage.addInitScript(() => {
      const originalCreate = URL.createObjectURL.bind(URL);
      const originalRevoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (value: Blob | MediaSource) => {
        const url = originalCreate(value);
        (globalThis as { __recordBlobUrl?: (url: string) => void }).__recordBlobUrl?.(url);
        return url;
      };
      URL.revokeObjectURL = (url: string) => {
        (globalThis as { __recordRevokedUrl?: (url: string) => void }).__recordRevokedUrl?.(url);
        return originalRevoke(url);
      };
    });

    // 3. Disable connectivity BEFORE opening the hub.
    await relaunched.setOffline(true);
    await coldPage.goto(`${origin}/offline`);

    // 4. Open the saved book client-locally (hash navigation, no RSC request).
    await coldPage.evaluate((bookId) => {
      globalThis.window.location.hash = `#book/${bookId}/1`;
    }, ids.readableBookId);

    const frame = coldPage.getByTestId('page-frame');
    await expect(frame).toBeVisible();

    // Wait for the real raster to decode, then assert positive dimensions.
    const decoded = await frame.evaluate(async (element) => {
      const image = element as HTMLImageElement;
      if (typeof image.decode === 'function') await image.decode();
      return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, src: image.src };
    });
    expect(decoded.naturalWidth).toBeGreaterThan(0);
    expect(decoded.naturalHeight).toBeGreaterThan(0);
    expect(decoded.src.startsWith('blob:')).toBe(true);

    // Matching page + text layer.
    await expect(coldPage.getByText('Page 1 of')).toBeVisible();
    await expect(coldPage.getByTestId('pdf-text-layer')).toBeVisible();

    // The rendered book version equals the published ready version.
    expect(await readActiveVersion(coldPage, ids.readerId, ids.readableBookId)).toBe(readyVersion);

    // Zero CSP violations under the actual production policy.
    expect(cspViolations).toEqual([]);

    // 5. Navigating to the next page and unmounting release every Blob URL.
    const nextButton = coldPage.getByLabel('Next page');
    if (await nextButton.isEnabled().catch(() => false)) {
      await nextButton.click();
      await expect.poll(() => revokedUrls.length).toBeGreaterThan(0);
    }
    await coldPage.evaluate(() => {
      globalThis.window.location.hash = '';
    });
    await expect.poll(() => createdUrls.length - revokedUrls.length).toBe(0);

    await relaunched.close();
  });
});

/** Reads the active ready version for one book from the real IndexedDB store. */
async function readActiveVersion(
  page: import('@playwright/test').Page,
  subject: string,
  bookId: string,
): Promise<number | null> {
  return page.evaluate(async ({ owner, id }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('transformlit-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ contentId: string; activeVersion: number | null }>>((resolve, reject) => {
      const tx = db.transaction('downloadManifests', 'readonly');
      const request = tx.objectStore('downloadManifests').index('subject').getAll(owner);
      request.onsuccess = () => resolve(request.result as Array<{ contentId: string; activeVersion: number | null }>);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.find((entry) => entry.contentId === id)?.activeVersion ?? null;
  }, { owner: subject, id: bookId });
}
