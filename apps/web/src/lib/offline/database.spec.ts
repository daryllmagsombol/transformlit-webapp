import {
  classifyStorageError,
  OfflineStorageError,
  QuotaExceededError,
  SchemaVersionError,
  StorageUnavailableError,
  SubjectMismatchError,
  TransactionAbortedError,
} from './contracts';
import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORES,
  OfflineDatabase,
  bookKey,
  bibleChapterKey,
  openOfflineDatabase,
  qualifyKey,
  resetOfflineDatabaseHandle,
  runTransaction,
} from './database';
import { createFakeIndexedDb } from '../../../test/helpers/fake-indexeddb';

const PRIVATE_STORES = [
  'downloadManifests',
  'bookVersions',
  'bookPages',
  'bibleChapters',
  'readerRecords',
  'tombstones',
  'conflicts',
  'outbox',
  'receipts',
] as const;

/** Minimal fake transaction/request so `runTransaction` control flow is testable. */
function createFakeTransaction() {
  type Handler = ((event?: unknown) => void) | null;
  const request = {
    result: undefined as unknown,
    error: null as Error | null,
    onsuccess: null as Handler,
    onerror: null as Handler,
  };
  const store = { get: jest.fn(() => request), put: jest.fn(() => request), delete: jest.fn(() => request) };
  const transaction = {
    error: null as Error | null,
    oncomplete: null as Handler,
    onabort: null as Handler,
    onerror: null as Handler,
    objectStore: jest.fn(() => store),
    abort: jest.fn(),
    store,
    request,
  };
  const db = { transaction: jest.fn(() => transaction) } as unknown as IDBDatabase;
  return { db, transaction, store, request };
}

describe('offline database schema', () => {
  it('is a single versioned database', () => {
    expect(OFFLINE_DB_NAME).toBe('transformlit-offline');
    expect(OFFLINE_DB_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('creates every store required by the contract', () => {
    const names = OFFLINE_STORES.map((store) => store.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'lifecycle',
        'leases',
        'downloadManifests',
        'bookVersions',
        'bookPages',
        'bibleChapters',
        'readerRecords',
        'tombstones',
        'conflicts',
        'outbox',
        'receipts',
      ]),
    );
  });

  it('namespaces every private store by an immutable subject index', () => {
    for (const name of PRIVATE_STORES) {
      const store = OFFLINE_STORES.find((candidate) => candidate.name === name);
      expect(store).toBeDefined();
      const subjectIndex = store?.indexes?.find((index) => index.name === 'subject');
      expect(subjectIndex?.keyPath).toBe('subject');
    }
  });

  it('uses compound keys that always include subject for private records', () => {
    expect(qualifyKey('user-a', 'book', 'b1')).toContain('user-a');
    expect(bookKey('user-a', 'b1')).toBe(qualifyKey('user-a', 'book', 'b1'));
    expect(bibleChapterKey('user-a', 'BSB', 'ROM', 8)).toBe(qualifyKey('user-a', 'bible', 'BSB', 'ROM', 8));
    expect(bookKey('user-a', 'b1')).not.toBe(bookKey('user-b', 'b1'));
  });
});

describe('storage error classification', () => {
  it('maps quota and abort DOMExceptions to typed errors', () => {
    expect(classifyStorageError(new DOMException('full', 'QuotaExceededError'))).toBeInstanceOf(QuotaExceededError);
    expect(classifyStorageError(new DOMException('aborted', 'AbortError'))).toBeInstanceOf(TransactionAbortedError);
  });

  it('wraps unknown errors as offline storage errors', () => {
    const classified = classifyStorageError(new Error('boom'));
    expect(classified.name).toBe('OfflineStorageError');
  });
});

describe('runTransaction result discipline (C1)', () => {
  it('rejects when the handler enqueues a request but never calls done()', async () => {
    const { db, transaction } = createFakeTransaction();
    const promise = runTransaction<void>(db, 'records', 'readonly', (tx) => {
      // Enqueue a request but never deliver a result.
      tx.objectStore('records').get('x');
    });
    transaction.oncomplete?.();
    await expect(promise).rejects.toBeInstanceOf(OfflineStorageError);
  });

  it('resolves the value supplied to done() only on oncomplete', async () => {
    const { db, transaction } = createFakeTransaction();
    const promise = runTransaction<number>(db, 'records', 'readonly', (_tx, done) => done(7));
    let resolved: number | undefined;
    void promise.then((value) => {
      resolved = value;
    });
    expect(resolved).toBeUndefined();
    transaction.oncomplete?.();
    await expect(promise).resolves.toBe(7);
  });

  it('rejects when a readonly handler throws even if a request later succeeds', async () => {
    const { db, transaction } = createFakeTransaction();
    const promise = runTransaction<void>(db, 'records', 'readonly', () => {
      throw new Error('handler exploded');
    });
    expect(transaction.abort).toHaveBeenCalled();
    transaction.oncomplete?.();
    await expect(promise).rejects.toThrow('handler exploded');
  });
});

describe('open cache discipline (I1)', () => {
  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('rejects with StorageUnavailableError when IndexedDB is absent', async () => {
    await expect(openOfflineDatabase()).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('retries with a fresh open after a failed attempt instead of reusing the rejection', async () => {
    const failing = createFakeIndexedDb({ openError: new Error('disk full') });
    (globalThis as { indexedDB?: unknown }).indexedDB = failing.indexedDB;

    await expect(openOfflineDatabase()).rejects.toThrow('disk full');
    await expect(openOfflineDatabase()).rejects.toThrow('disk full');
    // A rejected promise must not be cached: each call is a new attempt.
    expect(failing.openMock).toHaveBeenCalledTimes(2);
  });

  it('shares a single pending open between concurrent callers', async () => {
    const fake = createFakeIndexedDb();
    (globalThis as { indexedDB?: unknown }).indexedDB = fake.indexedDB;

    const first = openOfflineDatabase();
    const second = openOfflineDatabase();
    await Promise.all([first, second]);
    expect(fake.openMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('fails closed with SchemaVersionError on a VersionError open failure', async () => {
    const versionError = new Error('newer version exists');
    versionError.name = 'VersionError';
    const fake = createFakeIndexedDb({ openError: versionError });
    (globalThis as { indexedDB?: unknown }).indexedDB = fake.indexedDB;

    await expect(openOfflineDatabase()).rejects.toBeInstanceOf(SchemaVersionError);
  });

  it('rejects when an upgrade is blocked by another connection', async () => {
    const fake = createFakeIndexedDb({ blocked: true });
    (globalThis as { indexedDB?: unknown }).indexedDB = fake.indexedDB;

    await expect(openOfflineDatabase()).rejects.toThrow(/blocked/i);
    expect(fake.openMock).toHaveBeenCalledTimes(1);
  });
});

describe('schema upgrade safety (I3)', () => {
  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  /**
   * A minimal upgrade-capable fake whose `createObjectStore` throws the way real
   * IndexedDB does when the store already exists. This is the exact failure a
   * naive first version bump would hit.
   */
  function createUpgradeFake(oldVersion: number, existingStores: readonly string[] = []) {
    type Handler = ((event?: unknown) => void) | null;
    const existing = new Set(existingStores);
    const created: string[] = [];
    const db = {
      close: jest.fn(),
      createObjectStore: jest.fn((name: string) => {
        if (existing.has(name)) throw new DOMException(`store ${name} already exists`, 'ConstraintError');
        existing.add(name);
        created.push(name);
        return { createIndex: jest.fn() };
      }),
      objectStoreNames: { contains: (name: string) => existing.has(name) },
    } as unknown as IDBDatabase;
    const request: {
      result: IDBDatabase;
      error: Error | null;
      onupgradeneeded: Handler;
      onsuccess: Handler;
      onerror: Handler;
      onblocked: Handler;
    } = {
      result: db,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    const openMock = jest.fn(() => {
      queueMicrotask(() => {
        request.onupgradeneeded?.({ oldVersion });
        request.onsuccess?.({});
      });
      return request;
    });
    return {
      indexedDB: { open: openMock as unknown as (name: string, version?: number) => unknown },
      openMock,
      created,
    };
  }

  it('creates every store on a fresh database', async () => {
    const fake = createUpgradeFake(0);
    (globalThis as { indexedDB?: unknown }).indexedDB = fake.indexedDB;

    await expect(openOfflineDatabase()).resolves.toBeDefined();
    expect(fake.created).toEqual(OFFLINE_STORES.map((store) => store.name));
  });

  it('opens at a higher version over an existing store set without throwing', async () => {
    // Every store from version 1 already exists; the bump must not re-create
    // any of them or the ConstraintError aborts the upgrade and bricks the DB.
    const existing = OFFLINE_STORES.map((store) => store.name);
    const fake = createUpgradeFake(1, existing);
    (globalThis as { indexedDB?: unknown }).indexedDB = fake.indexedDB;

    await expect(openOfflineDatabase()).resolves.toBeDefined();
    expect(fake.created).toEqual([]);
  });

  it('skips stores that already exist even when a migration replays from zero', async () => {
    const existing = OFFLINE_STORES.map((store) => store.name);
    const fake = createUpgradeFake(0, existing);
    (globalThis as { indexedDB?: unknown }).indexedDB = fake.indexedDB;

    await expect(openOfflineDatabase()).resolves.toBeDefined();
    expect(fake.created).toEqual([]);
  });
});

describe('subject integrity guards (I2)', () => {
  const subject = 'user-a';
  const epoch = 1;

  function databaseWithLifecycle(): OfflineDatabase {
    const fakeDb = { transaction: jest.fn() } as unknown as IDBDatabase;
    return new OfflineDatabase(fakeDb);
  }

  it('rejects putAccountRecord when the record subject does not match', async () => {
    const db = databaseWithLifecycle();
    await expect(
      db.putAccountRecord(subject, epoch, 'readerRecords', { id: qualifyKey('user-b', 'r1'), subject: 'user-b' }),
    ).rejects.toBeInstanceOf(SubjectMismatchError);
  });

  it('rejects putAccountRecord when the embedded key is not namespaced by the subject', async () => {
    const db = databaseWithLifecycle();
    await expect(
      db.putAccountRecord(subject, epoch, 'readerRecords', { id: 'unscoped', subject }),
    ).rejects.toBeInstanceOf(SubjectMismatchError);
  });

  it('rejects commitEditWithOutbox when the outbox operation subject mismatches', async () => {
    const db = databaseWithLifecycle();
    await expect(
      db.commitEditWithOutbox({
        subject,
        epoch,
        record: { id: qualifyKey(subject, 'r1'), subject },
        operation: { id: qualifyKey(subject, 'op'), subject: 'user-b' },
      }),
    ).rejects.toBeInstanceOf(SubjectMismatchError);
  });

  it('accepts a correctly namespaced record before touching IndexedDB', async () => {
    const db = databaseWithLifecycle();
    // The fake transaction throws when actually used; the guard must pass first
    // and the failure must therefore be a transaction/storage error, not a
    // SubjectMismatchError.
    const outcome = await db
      .putAccountRecord(subject, epoch, 'readerRecords', { id: qualifyKey(subject, 'r1'), subject })
      .catch((error: unknown) => error);
    expect(outcome).not.toBeInstanceOf(SubjectMismatchError);
  });
});
