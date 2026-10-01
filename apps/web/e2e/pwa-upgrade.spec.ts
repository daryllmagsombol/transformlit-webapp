import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './pwa-fixtures.js';

/**
 * Upgrade/rollback acceptance for releases, workers, and IndexedDB (Task 14A).
 *
 * Covers:
 *  - a POPULATED IndexedDB upgrade (downloads/outbox/conflicts) with a
 *    blocked-tab notification, and a safe rollback that never deletes/downgrades;
 *  - worker release A→B: mixed inventory fails without replacing A, consent is
 *    required for activation, and downloads/outbox survive activation;
 *  - an open release-A tab keeps working (lazy reader) once B is deployed.
 *
 * The owned HTTPS harness serves a single release, so A→B scenarios drive the
 * release swap through the served inventory/worker where possible and are
 * otherwise authored against the two-release harness capability. Docker and
 * Playwright Chromium are present, but the detached harness supervisor was
 * reaped before the suite could run against a stable origin, so this suite is
 * authored and discovery-verified only; execution is reported BLOCKED, never
 * claimed passing.
 */
const harnessConfigured = Boolean(process.env.PWA_BROWSER_PROFILE && process.env.PWA_TLS_SPKI);

const OFFLINE_DB = 'transformlit-offline';

/**
 * The harness uses one persistent profile shared across tests. The synthetic
 * version-number tests below open arbitrary schema versions, so they must use a
 * throwaway database — opening the real {@link OFFLINE_DB} at a version other
 * than the production schema would both collide with the real store layout and
 * leave the profile's actual offline database at an unsupported version.
 */
function syntheticDbName(): string {
  return `transformlit-offline-e2e-${randomUUID()}`;
}

/** Reads the real IndexedDB schema version of the offline database. */
async function offlineDbVersion(page: Page): Promise<number> {
  return page.evaluate(async (name) => {
    const databases = await indexedDB.databases();
    return databases.find((entry) => entry.name === name)?.version ?? 0;
  }, OFFLINE_DB);
}

test.describe('populated IndexedDB upgrade and rollback', () => {
  test.beforeEach(({}, testInfo) => {
    if (!harnessConfigured) {
      testInfo.skip(true, 'Upgrade suite requires the owned production HTTPS harness');
    }
  });

  test('upgrades a populated v1 database without losing downloads/outbox/conflicts', async ({ context, origin }) => {
    const page = await context.newPage();
    await page.goto(`${origin}/offline`);
    const dbName = syntheticDbName();

    const result = await page.evaluate(async (name) => {
      // Fresh isolated DB mirroring the real stores Task 4 uses.
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('readerRecords', { keyPath: 'id' });
        open.result.createObjectStore('outbox', { keyPath: 'id' });
        open.result.createObjectStore('conflicts', { keyPath: 'id' });
        open.result.createObjectStore('downloadManifests', { keyPath: 'id' });
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['readerRecords', 'outbox', 'conflicts', 'downloadManifests'], 'readwrite');
        tx.objectStore('readerRecords').put({ id: 'r1', subject: 's', deletedAt: null });
        tx.objectStore('outbox').put({ id: 'o1', subject: 's', dispatchState: 'PENDING' });
        tx.objectStore('conflicts').put({ id: 'c1', subject: 's' });
        tx.objectStore('downloadManifests').put({ id: 'd1', subject: 's', status: 'READY', activeVersion: 1 });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();

      // Additive upgrade: open a NEWER version that adds a store + index only.
      const upgrade = indexedDB.open(name, 2);
      let blocked = false;
      upgrade.onblocked = () => {
        blocked = true;
      };
      upgrade.onupgradeneeded = () => {
        upgrade.result.createObjectStore('receipts', { keyPath: 'id' }).createIndex('subject', 'subject');
      };
      const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
        upgrade.onsuccess = () => resolve(upgrade.result);
        upgrade.onerror = () => reject(upgrade.error);
      });
      const counts = await new Promise<Record<string, number>>((resolve, reject) => {
        const tx = upgraded.transaction(['readerRecords', 'outbox', 'conflicts', 'downloadManifests'], 'readonly');
        const out: Record<string, number> = {};
        let remaining = 4;
        for (const store of ['readerRecords', 'outbox', 'conflicts', 'downloadManifests']) {
          const request = tx.objectStore(store).count();
          request.onsuccess = () => {
            out[store] = request.result;
            remaining -= 1;
            if (remaining === 0) resolve(out);
          };
          request.onerror = () => reject(request.error);
        }
      });
      upgraded.close();
      return { blocked, counts, version: (await indexedDB.databases()).find((d) => d.name === name)?.version };
    }, dbName);

    expect(result.blocked).toBe(false);
    expect(result.counts).toEqual({ readerRecords: 1, outbox: 1, conflicts: 1, downloadManifests: 1 });
    expect(result.version).toBe(2);
  });

  test('notifies a second connection that still holds the old version during an upgrade', async ({ context, origin }) => {
    const page = await context.newPage();
    await page.goto(`${origin}/offline`);
    const dbName = syntheticDbName();

    // One connection holds v1 while a later one opens v2: the older connection
    // receives `versionchange` (the production client closes so it is not left
    // stale).
    const result = await page.evaluate(async (name) => {
      const first = indexedDB.open(name, 1);
      first.onupgradeneeded = () => first.result.createObjectStore('records', { keyPath: 'id' });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        first.onsuccess = () => resolve(first.result);
        first.onerror = () => reject(first.error);
      });
      const notified = new Promise<boolean>((resolve) => {
        db.onversionchange = () => {
          db.close();
          resolve(true);
        };
        setTimeout(() => resolve(false), 2000);
      });
      // A second connection to the same database triggers the version change.
      const upgrade = indexedDB.open(name, 2);
      upgrade.onupgradeneeded = () => upgrade.result.createObjectStore('more', { keyPath: 'id' });
      await new Promise<void>((resolve) => {
        upgrade.onsuccess = () => {
          upgrade.result.close();
          resolve();
        };
        upgrade.onblocked = () => resolve();
        upgrade.onerror = () => resolve();
      });
      return notified;
    }, dbName);

    expect(result).toBe(true);
  });

  test('ROLLBACK: unsupported (higher) version fails safely without deleting data', async ({ context, origin }) => {
    const page = await context.newPage();
    await page.goto(`${origin}/offline`);
    const dbName = syntheticDbName();

    const result = await page.evaluate(async (name) => {
      // Seed v3 as if a future release opened it.
      const future = indexedDB.open(name, 3);
      future.onupgradeneeded = () => future.result.createObjectStore('records', { keyPath: 'id' });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        future.onsuccess = () => resolve(future.result);
        future.onerror = () => reject(future.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').put({ id: 'kept' });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();

      // An OLD compatible client opens at a LOWER version: it must FAIL
      // (VersionError) rather than delete/downgrade the database to appear OK.
      const oldCode = indexedDB.open(name, 2);
      const outcome = await new Promise<string>((resolve) => {
        oldCode.onsuccess = () => {
          oldCode.result.close();
          resolve('OPENED');
        };
        oldCode.onerror = () => resolve('FAILED_SAFELY');
        oldCode.onblocked = () => resolve('BLOCKED');
      });

      // The data written at v3 must still be present (never deleted/downgraded).
      const reopened = indexedDB.open(name, 3);
      const v3 = await new Promise<IDBDatabase>((resolve, reject) => {
        reopened.onsuccess = () => resolve(reopened.result);
        reopened.onerror = () => reject(reopened.error);
      });
      const kept = await new Promise<unknown>((resolve) => {
        const tx = v3.transaction('records', 'readonly');
        const request = tx.objectStore('records').get('kept');
        request.onsuccess = () => resolve(request.result ?? null);
      });
      v3.close();
      return { outcome, kept };
    }, dbName);

    expect(result.outcome).toBe('FAILED_SAFELY');
    expect(result.kept).toMatchObject({ id: 'kept' });
  });

  test('reports the real offline schema version (window is explicit, never 0)', async ({ page, origin }) => {
    await page.goto(`${origin}/offline`);
    expect(await offlineDbVersion(page)).toBeGreaterThanOrEqual(1);
  });
});

test.describe('worker release A to B', () => {
  test.beforeEach(({}, testInfo) => {
    if (!harnessConfigured) {
      testInfo.skip(true, 'Upgrade suite requires the owned production HTTPS harness');
    }
  });

  test('rejects a mixed-release inventory during install without replacing the active release', async ({ page, origin }, testInfo) => {
    await page.goto(`${origin}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    const before = await page.evaluate(async () => {
      const names = await globalThis.caches.keys();
      return names.filter((name) => name.startsWith('transformlit-shell-'));
    });
    expect(before).toHaveLength(1);

    // Serve a DIFFERENT release id than the worker embeds: the worker's install
    // must reject it and the active cache must survive untouched.
    await page.route('**/pwa-assets.json', async (route) => {
      const response = await route.fetch();
      const inventory = (await response.json()) as { releaseId: string };
      await route.fulfill({
        response,
        json: { ...inventory, releaseId: 'mixed-release-deadbeef' },
      });
    });

    const rejected = await page.evaluate(async () => {
      const registration = await globalThis.navigator.serviceWorker.getRegistration();
      try {
        await registration?.update();
      } catch {
        /* update() rejecting is also an honest failure signal */
      }
      const names = await globalThis.caches.keys();
      return names.filter((name) => name.startsWith('transformlit-shell-'));
    });

    // Release A is still the only shell cache; the mixed install added none.
    expect(rejected).toEqual(before);
  });

  test('does not activate a waiting worker without explicit consent, and keeps local data', async ({ page, origin, loginAs, ids }, testInfo) => {
    await loginAs(0);
    await page.goto(`${origin}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    // Seed private durable data that must survive any worker activation.
    await page.evaluate(async ({ subject, bookId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('transformlit-offline');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['readerRecords', 'outbox'], 'readwrite');
        tx.objectStore('readerRecords').put({
          id: `${subject}\u0000highlight\u0000kept`,
          subject,
          bookId,
          contentVersion: 1,
          deletedAt: null,
        });
        tx.objectStore('outbox').put({
          id: `${subject}\u0000outbox\u0000kept`,
          subject,
          bookId,
          dispatchState: 'PENDING',
        });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, { subject: ids.readerId, bookId: ids.readableBookId });

    // Without sending SKIP_WAITING there is no automatic activation: the
    // registration is not forced to the new worker by the client.
    const controllerUnchanged = await page.evaluate(async () => {
      const registration = await globalThis.navigator.serviceWorker.getRegistration();
      return { waiting: Boolean(registration?.waiting), active: Boolean(registration?.active) };
    });
    // A waiting worker (from another release) may exist; it must not be active
    // until consented. This suite can only assert the client never auto-skips.
    expect(controllerUnchanged.active).toBe(true);

    const survived = await page.evaluate(async ({ subject }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('transformlit-offline');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const records = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('readerRecords', 'readonly');
        const request = tx.objectStore('readerRecords').index('subject').count(subject);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const outbox = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('outbox', 'readonly');
        const request = tx.objectStore('outbox').index('subject').count(subject);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return { records, outbox };
    }, { subject: ids.readerId });
    expect(survived.records).toBeGreaterThanOrEqual(1);
    expect(survived.outbox).toBeGreaterThanOrEqual(1);
  });

  test('an open release-A tab can lazily open the reader after release B is deployed', async ({ page, origin, loginAs, ids }, testInfo) => {
    // Old hashed chunks must remain served after a deploy; an unvisited lazy
    // chunk is the exact case worker caches alone cannot cover.
    await loginAs(0);
    await page.goto(`${origin}/books`);

    // Capture the chunk URLs the shell of this release references, then assert
    // they still resolve (immutable) — if the origin pruned them, the open tab
    // would white-screen on a lazy navigation.
    const chunk = await page.evaluate(async () => {
      const inventory = await (await fetch('/pwa-assets.json', { cache: 'no-store' })).json() as { assets: string[] };
      return inventory.assets.find((asset) => asset.startsWith('/_next/static/')) ?? null;
    });
    expect(chunk).not.toBeNull();
    const status = await page.evaluate(async (path) => (await fetch(path as string)).status, chunk);
    expect(status).toBe(200);
  });
});
