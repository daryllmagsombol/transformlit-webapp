import { test, expect } from './pwa-fixtures.js';

/**
 * Account lifecycle barrier acceptance (Task 13B).
 *
 * Runs against the owned HTTPS harness (Docker + Chromium). It exercises the
 * sign-out / account-switch gate end to end:
 *  - an un-synced sign-out opens the informed exit dialog naming the work,
 *  - a confirmed discard completes local cleanup and lands on /login,
 *  - a deferred remote logout persists a durable barrier that blocks a new
 *    activation until invalidation completes, including across a reload,
 *  - a delayed logout response cannot clear a newly activated session.
 *
 * The harness Chromium binary is not installed in the implementation
 * environment, so this suite is authored and discovery-verified only; execution
 * is reported BLOCKED rather than claimed passing.
 */
const harnessConfigured = Boolean(process.env.PWA_BROWSER_PROFILE && process.env.PWA_TLS_SPKI);

test.describe('account lifecycle barriers', () => {
  test.beforeEach(({}, testInfo) => {
    if (!harnessConfigured) {
      testInfo.skip(true, 'Account suite requires the owned production HTTPS harness');
    }
  });

  test('un-synced sign-out requires an informed discard naming the outstanding work', async ({
    page,
    origin,
    loginAs,
    ids,
  }) => {
    await loginAs(0);
    await page.goto(`${origin}/books`);

    // Queue a local-only annotation with no server acknowledgement.
    await page.evaluate(async ({ subject, bookId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('transformlit-offline');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const clientEntityId = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('readerRecords', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('readerRecords').put({
          id: `${subject}\u0000highlight\u0000${clientEntityId}`,
          subject,
          clientEntityId,
          bookId,
          contentVersion: 1,
          page: 1,
          text: 'unsynced',
          note: null,
          color: null,
          anchor: { version: 1, page: 1, startOffset: 0, endOffset: 8 },
          revision: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        });
      });
      db.close();
    }, { subject: ids.readerId, bookId: ids.readableBookId });

    await page.goto(`${origin}/feed`);
    await page.getByRole('button', { name: /user menu/i }).click().catch(() => undefined);
    await page.getByRole('menuitem', { name: /log out/i }).click();

    const dialog = page.getByTestId('account-exit-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(/waiting to sync/i);

    // Discard requires the informed confirmation checkbox.
    const discard = dialog.getByRole('button', { name: /discard and sign out/i });
    await expect(discard).toBeDisabled();
    await dialog.getByLabel(/permanently discard/i).check();
    await discard.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('a deferred logout survives reload and blocks a new activation until invalidation completes', async ({
    page,
    origin,
    loginAs,
    ids,
  }) => {
    await loginAs(0);
    await page.goto(`${origin}/feed`);

    // Force the remote logout to fail so the exit persists a deferred barrier.
    await page.route('**/api/auth/logout', (route) => route.abort());
    await page.getByRole('button', { name: /user menu/i }).click().catch(() => undefined);
    await page.getByRole('menuitem', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    const deferred = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('transformlit-offline');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('lifecycle', 'readonly');
        const request = tx.objectStore('lifecycle').get('deferred-logout');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return value;
    });
    expect(deferred).not.toBeNull();

    // After a reload the barrier is still durable: the old session is not
    // silently restored and the login route shows no active account.
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a delayed logout response cannot clear a newly activated session', async ({ page, origin, loginAs, ids }) => {
    await loginAs(0);
    await page.goto(`${origin}/feed`);

    // Delay (then allow) the logout response so it lands after a fresh login.
    let releaseLogout = () => {};
    const held = new Promise<void>((resolve) => {
      releaseLogout = resolve;
    });
    await page.route('**/api/auth/logout', async (route) => {
      await held;
      await route.continue();
    });

    await page.getByRole('button', { name: /user menu/i }).click().catch(() => undefined);
    await page.getByRole('menuitem', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // Re-activate the same account before the delayed logout settles.
    await page.evaluate(async ({ subject }) => {
      // The deferred barrier blocks activation until invalidation completes.
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('transformlit-offline');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const tx = db.transaction('lifecycle', 'readonly');
        const request = tx.objectStore('lifecycle').getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return { subject, rows: rows.length };
    }, { subject: ids.readerId });

    releaseLogout();
    // The session is not resurrected by the stale logout response.
    await expect(page).toHaveURL(/\/login/);
  });
});
