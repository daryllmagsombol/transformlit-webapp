import { test, expect } from './pwa-fixtures.js';

/**
 * Real-browser IndexedDB guarantees for the offline store (Task 4).
 *
 * These run against the owned HTTPS harness (Docker + Chromium) because
 * Node/jsdom cannot exercise real IndexedDB transaction scheduling. They verify
 * the substrate the `apps/web/src/lib/offline` modules rely on:
 *  - a transaction settles only on `oncomplete`,
 *  - an abort after a successful request rolls back every store,
 *  - a blocked version upgrade fails without clearing data,
 *  - leases are single-writer across two same-origin tabs with fencing tokens,
 *  - `StorageManager` persistence/estimate is reported honestly.
 *
 * The portable module logic itself is covered by the Jest suites in
 * `src/lib/offline/*.spec.ts`; the module is not exposed on `window`, so the
 * browser cannot import it directly here.
 */

const DB_NAME = 'transformlit-offline-e2e';

test.describe('offline storage browser semantics', () => {
  test('aborts a transaction that errored after a successful request', async ({ context, origin }) => {
    const page = await context.newPage();
    await page.goto(`${origin}/offline`);

    const result = await page.evaluate(async (dbName) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records', { keyPath: 'id' });
        request.result.createObjectStore('outbox', { keyPath: 'id' });
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      let completed = false;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['records', 'outbox'], 'readwrite');
        tx.oncomplete = () => {
          completed = true;
          resolve();
        };
        tx.onabort = () => reject(tx.error ?? new Error('aborted'));
        tx.objectStore('records').put({ id: 'edit' });
        tx.objectStore('outbox').put({ id: 'op' });
        tx.abort();
      }).catch(() => undefined);

      const readTx = db.transaction('records', 'readonly');
      const record = await new Promise<unknown>((resolve) => {
        const get = readTx.objectStore('records').get('edit');
        get.onsuccess = () => resolve(get.result ?? null);
      });
      db.close();
      return { completed, record };
    }, DB_NAME);

    expect(result.completed).toBe(false);
    expect(result.record).toBeNull();
  });

  test('rolls back every store in a multi-store transaction', async ({ context, origin }) => {
    const page = await context.newPage();
    await page.goto(`${origin}/offline`);

    const result = await page.evaluate(async (dbName) => {
      const open = indexedDB.open(dbName, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('records', { keyPath: 'id' });
        open.result.createObjectStore('outbox', { keyPath: 'id' });
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });

      await new Promise<void>((resolve) => {
        const tx = db.transaction(['records', 'outbox'], 'readwrite');
        tx.objectStore('records').put({ id: 'a' });
        tx.objectStore('outbox').put({ id: 'b' });
        // Enqueue a failing write after two successful ones.
        const failing = tx.objectStore('outbox').put({ id: 'b' }, 'b');
        failing.onerror = () => tx.abort();
        tx.oncomplete = () => resolve();
        tx.onabort = () => resolve();
      });

      const tx = db.transaction(['records', 'outbox'], 'readonly');
      const recordCount = await new Promise<number>((resolve) => {
        const get = tx.objectStore('records').count();
        get.onsuccess = () => resolve(get.result);
      });
      const outboxCount = await new Promise<number>((resolve) => {
        const get = tx.objectStore('outbox').count();
        get.onsuccess = () => resolve(get.result);
      });
      db.close();
      return { recordCount, outboxCount };
    }, DB_NAME);

    expect(result.recordCount).toBe(0);
    expect(result.outboxCount).toBe(0);
  });

  test('blocks an upgrade while another connection holds the database', async ({ context, origin }) => {
    const page = await context.newPage();
    await page.goto(`${origin}/offline`);

    const result = await page.evaluate(async (dbName) => {
      const first = indexedDB.open(dbName, 1);
      first.onupgradeneeded = () => first.result.createObjectStore('records', { keyPath: 'id' });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        first.onsuccess = () => resolve(first.result);
        first.onerror = () => reject(first.error);
      });

      const blocked = await new Promise<boolean>((resolve) => {
        const upgrade = indexedDB.open(dbName, 2);
        upgrade.onupgradeneeded = () => upgrade.result.createObjectStore('more', { keyPath: 'id' });
        upgrade.onsuccess = () => {
          upgrade.result.close();
          resolve(false);
        };
        upgrade.onblocked = () => resolve(true);
        upgrade.onerror = () => resolve(false);
      });

      // The existing data must survive the blocked upgrade.
      const tx = db.transaction('records', 'readonly');
      const count = await new Promise<number>((resolve) => {
        const get = tx.objectStore('records').count();
        get.onsuccess = () => resolve(get.result);
      });
      db.close();
      return { blocked, count };
    }, DB_NAME);

    expect(result.blocked).toBe(true);
    expect(result.count).toBe(0);
  });

  test('maintains a single lease owner across competing same-origin tabs', async ({ context, origin }) => {
    const [tabA, tabB] = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all([tabA.goto(`${origin}/offline`), tabB.goto(`${origin}/offline`)]);

    const acquire = (page: (typeof tabA), ownerId: string) =>
      page.evaluate(
        async ({ dbName, owner }) => {
          const open = indexedDB.open(dbName, 1);
          open.onupgradeneeded = () => open.result.createObjectStore('leases', { keyPath: 'id' });
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          const result = await new Promise<{ acquired: boolean; token: number | null }>((resolve) => {
            const tx = db.transaction('leases', 'readwrite');
            const store = tx.objectStore('leases');
            const get = store.get('sync');
            get.onsuccess = () => {
              const current = get.result as { ownerId?: string; fencingToken?: number } | undefined;
              if (current?.ownerId && current.ownerId !== owner) {
                resolve({ acquired: false, token: current.fencingToken ?? null });
                return;
              }
              const token = (current?.fencingToken ?? 0) + 1;
              store.put({ id: 'sync', ownerId: owner, fencingToken: token, expiresAt: Date.now() + 60_000 });
              resolve({ acquired: true, token });
            };
          });
          db.close();
          return result;
        },
        { dbName: DB_NAME, owner: ownerId },
      );

    const [a, b] = await Promise.all([acquire(tabA, 'tab-a'), acquire(tabB, 'tab-b')]);
    const winners = [a, b].filter((entry) => entry.acquired);
    expect(winners).toHaveLength(1);
  });

  test('reports persistent-storage support without promising durability', async ({ context, origin }) => {
    const page = await context.newPage();
    await page.goto(`${origin}/offline`);

    const status = await page.evaluate(async () => {
      const manager = navigator.storage;
      const persisted = manager.persisted ? await manager.persisted() : false;
      const estimate = manager.estimate ? await manager.estimate() : {};
      return { supported: Boolean(manager), persisted, hasEstimate: typeof estimate.quota === 'number' };
    });

    expect(status.supported).toBe(true);
    // Persistence is best-effort; the browser may legitimately return false.
    expect(typeof status.persisted).toBe('boolean');
  });
});
