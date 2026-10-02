import { type Page, type Response as PlaywrightResponse } from '@playwright/test';
import { test, expect } from './pwa-fixtures.js';

interface PersistedExitState {
  readonly lifecycle: { readonly state: string; readonly subject: string | null; readonly epoch: number } | null;
  readonly barrier: { readonly subject: string; readonly epoch: number } | null;
  readonly deferred: { readonly subject: string; readonly epoch: number } | null;
}

async function readPersistedExitState(page: Page): Promise<PersistedExitState> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('transformlit-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction('lifecycle', 'readonly');
      const store = tx.objectStore('lifecycle');
      const lifecycle = store.get('lifecycle');
      const barrier = store.get('lifecycle-barrier');
      const deferred = store.get('deferred-logout');
      const results: unknown[] = [];
      let remaining = 3;
      const collect = (index: number, request: IDBRequest) => {
        request.onsuccess = () => {
          results[index] = request.result ?? null;
          remaining -= 1;
          if (remaining === 0) resolve(results);
        };
        request.onerror = () => reject(request.error);
      };
      collect(0, lifecycle);
      collect(1, barrier);
      collect(2, deferred);
    });
    db.close();
    return {
      lifecycle: values[0] as PersistedExitState['lifecycle'],
      barrier: values[1] as PersistedExitState['barrier'],
      deferred: values[2] as PersistedExitState['deferred'],
    };
  });
}

async function submitLoginForm(page: Page, email: string, password: string): Promise<PlaywrightResponse> {
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === '/api/auth/login' && candidate.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    page.getByRole('button', { name: /log in/i }).click({ timeout: 15_000 }),
  ]);
  return response;
}

/**
 * Account lifecycle barrier acceptance (Task 13B).
 *
 * Runs against the owned HTTPS harness (Docker + Chromium). It exercises the
 * sign-out / account-switch gate end to end:
 *  - an un-synced sign-out opens the informed exit dialog naming the work,
 *  - a confirmed discard completes local cleanup and lands on /login,
 *  - a deferred remote logout persists a durable barrier, blocks an actual
 *    login installation across reload, and offers an informed local recovery,
 *  - a delayed logout keeps sign-out pending until remote invalidation settles;
 *    a later legitimate session survives reload.
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
    // A bare readerRecords row with no outbox op is LOCAL-ONLY work; the dialog
    // names it as "saved only on this device" (not "waiting to sync").
    await expect(dialog).toContainText(/saved only on this device/i);

    // Discard requires the informed confirmation checkbox.
    const discard = dialog.getByRole('button', { name: /discard and sign out/i });
    await expect(discard).toBeDisabled();
    await dialog.getByLabel(/permanently discard/i).check();
    await discard.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('a deferred logout blocks activation until the informed local recovery is chosen', async ({
    page,
    origin,
    loginAs,
    ids,
  }) => {
    await loginAs(0);
    await page.goto(`${origin}/feed`);
    const ownerBeforeExit = await readPersistedExitState(page);
    expect(ownerBeforeExit.lifecycle).toMatchObject({ state: 'ACTIVE', subject: ids.readerId });

    // Force the remote logout to fail so the exit persists a deferred barrier.
    await page.route('**/api/auth/logout', (route) => route.abort());
    await page.getByRole('button', { name: /user menu/i }).click();
    await page.getByRole('menuitem', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    const recovery = page.getByTestId('account-exit-dialog');
    await expect(recovery).toBeVisible({ timeout: 10_000 });
    const deferred = await readPersistedExitState(page);
    expect(deferred.deferred).toMatchObject({ subject: ids.readerId, epoch: ownerBeforeExit.lifecycle?.epoch });
    expect(deferred.barrier).toMatchObject({ subject: ids.readerId, epoch: ownerBeforeExit.lifecycle?.epoch });
    expect(deferred.lifecycle).toMatchObject({ state: 'SIGNED_OUT', subject: null });
    const fencedEpoch = deferred.lifecycle?.epoch;

    // Reload must preserve the barrier and must not restore the old account.
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    const reloadedRecovery = page.getByTestId('account-exit-dialog');
    await expect(reloadedRecovery).toBeVisible({ timeout: 10_000 });
    await expect(reloadedRecovery).toContainText(/could not confirm/i);

    // Dismissing the recovery dialog does not clear its durable fence. A real
    // login API response may succeed, but lifecycle installation must remain
    // blocked and leave ownership/epoch unchanged.
    await reloadedRecovery.getByRole('button', { name: /cancel/i }).click();
    const credentials = JSON.parse(process.env.PWA_FIXTURE_CREDENTIALS ?? '[]') as Array<{ email: string; password: string }>;
    const attemptedLogin = await submitLoginForm(page, credentials[0].email, credentials[0].password);
    expect(attemptedLogin.ok()).toBe(true);
    await expect(page.getByText(/could not activate this account/i)).toBeVisible({ timeout: 10_000 });
    const blockedActivation = await readPersistedExitState(page);
    expect(blockedActivation.lifecycle).toMatchObject({ state: 'SIGNED_OUT', subject: null, epoch: fencedEpoch });
    expect(blockedActivation.deferred).toMatchObject({ subject: ids.readerId, epoch: ownerBeforeExit.lifecycle?.epoch });
    expect(await page.evaluate(() => {
      const persisted = localStorage.getItem('auth-storage');
      return persisted ? JSON.parse(persisted).state?.user ?? null : null;
    })).toBeNull();

    // The documented recovery is an explicit, informed local discard; it does
    // not pretend the failed remote logout was confirmed. It clears the local
    // barrier so the user can perform a fresh legitimate login afterward.
    await page.reload();
    const confirmedRecovery = page.getByTestId('account-exit-dialog');
    await expect(confirmedRecovery).toBeVisible({ timeout: 10_000 });
    await confirmedRecovery.getByLabel(/permanently discards/i).check();
    await confirmedRecovery.getByRole('button', { name: /reset this device/i }).click();
    await expect(confirmedRecovery).not.toBeVisible({ timeout: 10_000 });
    const recovered = await readPersistedExitState(page);
    expect(recovered.deferred).toBeNull();
    expect(recovered.barrier).toBeNull();
    expect(recovered.lifecycle).toMatchObject({ state: 'SIGNED_OUT', subject: null, epoch: fencedEpoch });

    const freshLogin = await submitLoginForm(page, credentials[0].email, credentials[0].password);
    expect(freshLogin.ok()).toBe(true);
    await expect(page).toHaveURL(/\/feed(?:\?|$)/, { timeout: 15_000 });
    const activated = await readPersistedExitState(page);
    expect(activated.lifecycle).toMatchObject({ state: 'ACTIVE', subject: ids.readerId });
    expect(activated.lifecycle?.epoch).toBeGreaterThan(fencedEpoch ?? 0);
  });

  test('offers a user-reachable recovery when the session cannot be confirmed', async ({
    page,
    origin,
    loginAs,
  }) => {
    await loginAs(0);
    await page.goto(`${origin}/feed`);

    // Fail the remote logout so the durable barrier persists (unconfirmable).
    await page.route('**/api/auth/logout', (route) => route.abort());
    await page.getByRole('button', { name: /user menu/i }).click().catch(() => undefined);
    await page.getByRole('menuitem', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // The login (activation) surface surfaces the informed recovery escape.
    const dialog = page.getByTestId('account-exit-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(/could not be confirmed/i);

    const reset = dialog.getByRole('button', { name: /reset this device/i });
    await expect(reset).toBeDisabled();
    await dialog.getByLabel(/permanently discards/i).check();
    await reset.click();

    // The barrier is cleared and the device is no longer blocked from activation.
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });

  test('a delayed logout keeps sign-out pending, then a subsequent session survives reload', async ({ page, origin, loginAs, ids }) => {
    await loginAs(0);
    await page.goto(`${origin}/feed`);
    const original = await readPersistedExitState(page);
    expect(original.lifecycle).toMatchObject({ state: 'ACTIVE', subject: ids.readerId });

    // Logout holds the shared auth-lifecycle lock while its remote invalidation
    // is pending. The UI must not finish sign-out or install another session
    // before that result settles; this intentionally tests serialization rather
    // than an impossible overlapping successful activation.
    let releaseLogout: () => void = () => {};
    let logoutSeen = false;
    const held = new Promise<void>((resolve) => {
      releaseLogout = resolve;
    });
    const logoutResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/logout', { timeout: 30_000 }).catch((error: unknown) => ({ error }));
    await page.route('**/api/auth/logout', async (route) => {
      logoutSeen = true;
      await held;
      await route.continue();
    });

    try {
      await page.getByRole('button', { name: /user menu/i }).click();
      await page.getByRole('menuitem', { name: /log out/i }).click();
      await expect.poll(() => logoutSeen, { timeout: 15_000 }).toBe(true);
      await expect(page).toHaveURL(/\/feed/);
      const pendingExit = await readPersistedExitState(page);
      expect(pendingExit.lifecycle).toMatchObject({ state: 'SIGNED_OUT', subject: null });
      expect(pendingExit.lifecycle?.epoch).toBeGreaterThan(original.lifecycle?.epoch ?? 0);
      expect(pendingExit.barrier).toMatchObject({ subject: ids.readerId, epoch: original.lifecycle?.epoch });
      expect(pendingExit.deferred).toBeNull();

      releaseLogout();
      const logoutResponse = await logoutResponsePromise;
      if ('error' in logoutResponse) {
        throw new Error('Delayed logout did not receive an HTTP response after being released', { cause: logoutResponse.error });
      }
      expect(logoutResponse.ok()).toBe(true);
      const invalidation = await logoutResponse.json() as { revoked?: boolean };
      expect(invalidation.revoked).toBe(true);
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
      await page.unroute('**/api/auth/logout');

      const login = await loginAs(0);
      expect(login.length).toBeGreaterThan(0);
      const newSession = await readPersistedExitState(page);
      expect(newSession.lifecycle).toMatchObject({ state: 'ACTIVE', subject: ids.readerId });
      expect(newSession.lifecycle?.epoch).toBeGreaterThan(pendingExit.lifecycle?.epoch ?? 0);

      await page.reload();
      await expect(page).toHaveURL(/\/feed(?:\?|$)/, { timeout: 15_000 });
      const reloadedSession = await readPersistedExitState(page);
      expect(reloadedSession.lifecycle).toMatchObject({ state: 'ACTIVE', subject: ids.readerId });
      expect(reloadedSession.lifecycle?.epoch).toBe(newSession.lifecycle?.epoch);
    } finally {
      releaseLogout();
      await page.unroute('**/api/auth/logout').catch(() => undefined);
    }
  });
});
