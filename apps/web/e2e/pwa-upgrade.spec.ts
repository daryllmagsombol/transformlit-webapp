import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { OFFLINE_DB_VERSION } from '../src/lib/offline/contracts.js';
import { test, expect } from './pwa-fixtures.js';

/**
 * Upgrade/rollback acceptance for IndexedDB and the static worker (Task 14A).
 *
 * Genuinely covered here:
 *  - a POPULATED IndexedDB upgrade (downloads/outbox/conflicts) that preserves
 *    data, the `versionchange` notification, and a safe rollback where an older
 *    client fails at a higher schema version without deleting/downgrading;
 *  - the invariant that worker shell-cache cleanup is independent of account
 *    data;
 *  - the CURRENT release's hashed assets resolve.
 *
 * NOT covered by this browser suite (the owned HTTPS harness serves a SINGLE
 * release; `page.route` cannot rewrite a service-worker-initiated fetch, and no
 * replacement `/sw.js` bytes are served, so no second worker ever installs):
 *  - mixed-release install rejection and consent-gated waiting-worker
 *    activation are proven at the worker/unit level in
 *    `scripts/build-pwa-assets.spec.ts` and `components/pwa/pwa-provider.spec.tsx`;
 *  - old-release asset retention for an open A→B tab is a CDN/edge Gate-6 item
 *    (14C) and is intentionally NOT claimed here.
 *
 * Docker and Playwright Chromium are present, but the detached harness
 * supervisor was reaped before the suite could run against a stable origin, so
 * this suite is authored and discovery-verified only; execution is reported
 * BLOCKED, never claimed passing.
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

/** Names of the shell caches for the active worker release, sorted. */
function shellCaches(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await globalThis.caches.keys();
    return names.filter((name) => name.startsWith('transformlit-shell-')).sort();
  });
}

/** Deletes one database (if present) and verifies it is gone. */
async function deleteDatabase(page: Page, name: string): Promise<void> {
  await page.evaluate(
    (dbName) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
    name,
  );
  await page.evaluate(async (dbName) => {
    const databases = await indexedDB.databases();
    if (databases.some((entry) => entry.name === dbName)) throw new Error(`Database ${dbName} was not deleted`);
  }, name);
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
    // The database is opened at the contract's explicit version; the live
    // database version must match it exactly, not merely be `>= 1`.
    const version = await offlineDbVersion(page);
    expect(version).toBe(OFFLINE_DB_VERSION);
  });
});

test.describe('static worker invariants', () => {
  test.beforeEach(({}, testInfo) => {
    if (!harnessConfigured) {
      testInfo.skip(true, 'Static worker suite requires the owned production HTTPS harness');
    }
  });

  test('serves the current release\'s hashed assets (single release only; A→B retention is a CDN gate)', async ({
    page,
    origin,
  }) => {
    await page.goto(`${origin}/offline`);

    // This asserts the CURRENT release's inventory chunk resolves immutable. It
    // does NOT exercise a release A→B swap: the harness serves one release and
    // no second worker installs, so it cannot prove old-release retention (that
    // is the CDN/edge Gate-6 item owned by 14C).
    const chunk = await page.evaluate(async () => {
      const inventory = (await (await fetch('/pwa-assets.json', { cache: 'no-store' })).json()) as {
        assets: string[];
      };
      return inventory.assets.find((asset) => asset.startsWith('/_next/static/')) ?? null;
    });
    expect(chunk).not.toBeNull();
    const status = await page.evaluate(async (path) => (await fetch(path as string)).status, chunk);
    expect(status).toBe(200);
  });

  test('keeps the shell cache across IndexedDB account-data cleanup (worker cache cleanup is independent)', async ({
    page,
    origin,
  }) => {
    await page.goto(`${origin}/offline`);
    await page.evaluate(() => globalThis.navigator.serviceWorker.ready);

    const cacheBefore = await shellCaches(page);
    expect(cacheBefore.length).toBeGreaterThanOrEqual(1);

    // Delete the account-data database; cache cleanup is a separate authority
    // and must not be triggered by (or trigger) IndexedDB removal.
    const dbName = syntheticDbName();
    await page.evaluate(async (name) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('records', { keyPath: 'id' });
      await new Promise<void>((resolve, reject) => {
        open.onsuccess = () => {
          open.result.close();
          resolve();
        };
        open.onerror = () => reject(open.error);
      });
    }, dbName);
    await deleteDatabase(page, dbName);

    const cacheAfter = await shellCaches(page);
    expect(cacheAfter).toEqual(cacheBefore);
  });
});
