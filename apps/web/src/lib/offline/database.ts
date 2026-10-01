import {
  classifyStorageError,
  keyBelongsToSubject,
  type LifecycleStateRecord,
  type LeaseRecord,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OfflineStorageError,
  SchemaVersionError,
  StorageUnavailableError,
  SubjectMismatchError,
  TransactionAbortedError,
} from './contracts';
import type { LeasePersistence } from './coordination';

export { OFFLINE_DB_NAME, OFFLINE_DB_VERSION, bookKey, bibleChapterKey, qualifyKey } from './contracts';

export interface StoreIndexSchema {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
}

export interface StoreSchema {
  name: string;
  keyPath: string;
  indexes?: StoreIndexSchema[];
}

/**
 * The single versioned schema. Every private store carries a `subject` index
 * so account data can be enumerated and cleared without scanning unrelated
 * subjects. Store/key naming and index layout are part of the compatibility
 * window: additive changes bump the version; unsupported versions fail closed.
 */
export const OFFLINE_STORES: readonly StoreSchema[] = [
  { name: 'lifecycle', keyPath: 'id' },
  {
    name: 'leases',
    keyPath: 'id',
    indexes: [{ name: 'subject', keyPath: 'subject' }],
  },
  {
    name: 'downloadManifests',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectContent', keyPath: ['subject', 'contentId', 'contentVersion'] },
    ],
  },
  {
    name: 'bookVersions',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectBookVersion', keyPath: ['subject', 'bookId', 'contentVersion'], unique: true },
    ],
  },
  {
    name: 'bookPages',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectBookVersion', keyPath: ['subject', 'bookId', 'contentVersion'] },
      { name: 'subjectBookPage', keyPath: ['subject', 'bookId', 'contentVersion', 'pageNumber'], unique: true },
    ],
  },
  {
    name: 'bibleChapters',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectTranslation', keyPath: ['subject', 'translation'] },
      { name: 'subjectRef', keyPath: ['subject', 'translation', 'book', 'chapter'], unique: true },
    ],
  },
  {
    name: 'readerRecords',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectEntity', keyPath: ['subject', 'entityId'] },
      { name: 'subjectBook', keyPath: ['subject', 'bookId'] },
    ],
  },
  {
    name: 'tombstones',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectEntity', keyPath: ['subject', 'entityId'] },
    ],
  },
  {
    name: 'conflicts',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectEntity', keyPath: ['subject', 'sourceEntityId'] },
    ],
  },
  {
    name: 'outbox',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectEntity', keyPath: ['subject', 'entityKey'] },
      { name: 'subjectSeq', keyPath: ['subject', 'seq'] },
    ],
  },
  {
    name: 'receipts',
    keyPath: 'id',
    indexes: [
      { name: 'subject', keyPath: 'subject' },
      { name: 'subjectOperation', keyPath: ['subject', 'operationId'], unique: true },
    ],
  },
];

/** Private stores enumerated when clearing one account's local footprint. */
const PRIVATE_SUBJECT_STORES: readonly string[] = [
  'downloadManifests',
  'bookVersions',
  'bookPages',
  'bibleChapters',
  'readerRecords',
  'tombstones',
  'conflicts',
  'outbox',
  'receipts',
];

let cachedDatabase: Promise<IDBDatabase> | null = null;

function createSchema(db: IDBDatabase): void {
  for (const schema of OFFLINE_STORES) {
    const store = db.createObjectStore(schema.name, { keyPath: schema.keyPath });
    for (const index of schema.indexes ?? []) {
      store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
    }
  }
}

/**
 * Opens (and upgrades) the single offline database. A `VersionError` — an
 * older client meeting a newer schema — fails closed with `SchemaVersionError`
 * and never deletes data. `onblocked` is treated as a failure to upgrade now;
 * it never clears the existing database.
 *
 * The cache only holds a promise that is still pending or already resolved. A
 * failed open clears the cache exactly when it rejects, so a later caller
 * retries with a fresh open instead of inheriting the rejected promise, and
 * concurrent callers during a pending open share the same attempt.
 */
export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (cachedDatabase) return cachedDatabase;

  const attempt = openDatabaseAttempt();
  cachedDatabase = attempt;
  attempt.catch(() => {
    if (cachedDatabase === attempt) cachedDatabase = null;
  });

  return attempt;
}

function openDatabaseAttempt(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof globalThis.indexedDB === 'undefined') {
      reject(new StorageUnavailableError());
      return;
    }

    const request = globalThis.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    let settled = false;

    request.onupgradeneeded = () => createSchema(request.result);
    request.onblocked = () => {
      // Another connection holds an older version. Fail closed now rather than
      // hanging; if the request later succeeds it is closed without being used.
      if (settled) return;
      settled = true;
      reject(new OfflineStorageError('Offline database upgrade blocked by another open connection'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        if (cachedDatabase) cachedDatabase = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      const error = request.error;
      if (error?.name === 'VersionError') reject(new SchemaVersionError(error.message));
      else reject(classifyStorageError(error));
    };
  });
}

export function resetOfflineDatabaseHandle(): void {
  cachedDatabase = null;
}

/**
 * Runs an IndexedDB transaction and resolves strictly on `transaction.oncomplete`.
 *
 * `operation` must only enqueue synchronous IndexedDB requests; it must never
 * await network I/O. Awaiting inside a live transaction lets it auto-commit and
 * lose atomicity, so the signature deliberately offers no async escape hatch:
 * results are delivered through `done` and failures through `fail`.
 *
 * `done` is mandatory. If the transaction completes without the caller invoking
 * it — a handler that threw or forgot to deliver a result — the promise rejects
 * rather than resolving `undefined`/`null`. Request-level errors are surfaced
 * as rejections even when they do not abort the transaction.
 */
export function runTransaction<T>(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (error) {
      reject(classifyStorageError(error));
      return;
    }

    let output: T | undefined;
    let doneCalled = false;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(classifyStorageError(error));
    };
    const done = (value: T) => {
      if (settled || doneCalled) return;
      doneCalled = true;
      output = value;
    };

    tx.oncomplete = () => {
      if (settled) return;
      if (!doneCalled) {
        settled = true;
        reject(new OfflineStorageError('Transaction completed without a result'));
        return;
      }
      settled = true;
      resolve(output as T);
    };
    tx.onabort = () => fail(tx.error ?? new TransactionAbortedError());
    tx.onerror = () => fail(tx.error ?? new OfflineStorageError('IndexedDB transaction failed'));

    try {
      operation(tx, done, fail);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* transaction already settled or aborted */
      }
      fail(error);
    }
  });
}

export interface CommitEditInput<TRecord> {
  subject: string;
  epoch: number;
  record: TRecord;
  operation: unknown;
}

/** Reads the authoritative lifecycle record and aborts if the write is fenced. */
function guardWrite(
  tx: IDBTransaction,
  subject: string,
  epoch: number,
  fail: (error: unknown) => void,
  write: () => void,
): void {
  const request = tx.objectStore('lifecycle').get('lifecycle');
  request.onsuccess = () => {
    const state = request.result as LifecycleStateRecord | undefined;
    if (!state || state.subject !== subject) {
      fail(new OfflineStorageError(`Refusing write for unowned subject ${subject}`));
      tx.abort();
      return;
    }
    if (state.epoch !== epoch) {
      fail(new OfflineStorageError(`Refusing write for stale lifecycle epoch ${epoch}`));
      tx.abort();
      return;
    }
    write();
  };
  request.onerror = () => {
    fail(request.error ?? new OfflineStorageError('Could not read lifecycle state'));
    tx.abort();
  };
}

/**
 * Verifies that a record's declared `subject` (and, when present, an embedded
 * key) match the lifecycle subject before the write is enqueued. This catches
 * caller bugs that would otherwise store account A's record under account B's
 * lifecycle context.
 */
function assertRecordSubject(subject: string, record: unknown): void {
  if (typeof record !== 'object' || record === null) {
    throw new SubjectMismatchError('Private record must be an object carrying a subject');
  }
  const candidate = record as { subject?: unknown; id?: unknown };
  if (candidate.subject !== subject) {
    throw new SubjectMismatchError(
      `Record subject ${String(candidate.subject)} does not match lifecycle subject ${subject}`,
    );
  }
  if (typeof candidate.id === 'string' && !keyBelongsToSubject(subject, candidate.id)) {
    throw new SubjectMismatchError('Record key is not namespaced by its subject');
  }
}

/**
 * Application-level access to the offline store. Private reads/writes are
 * account-scoped; mutations validate subject + lifecycle epoch inside the same
 * transaction that writes, so a fenced operation rolls back entirely.
 */
export class OfflineDatabase {
  private readonly dbPromise: Promise<IDBDatabase>;

  constructor(db?: IDBDatabase) {
    this.dbPromise = db ? Promise.resolve(db) : openOfflineDatabase();
  }

  private db(): Promise<IDBDatabase> {
    return this.dbPromise;
  }

  async get<T>(store: string, key: IDBValidKey): Promise<T | null> {
    const db = await this.db();
    return runTransaction<T | null>(db, store, 'readonly', (tx, done) => {
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => done((request.result as T | undefined) ?? null);
    });
  }

  async put<T>(store: string, value: T): Promise<void> {
    const db = await this.db();
    await runTransaction<void>(db, store, 'readwrite', (tx, done) => {
      const request = tx.objectStore(store).put(value);
      request.onsuccess = () => done(undefined);
    });
  }

  async delete(store: string, key: IDBValidKey): Promise<void> {
    const db = await this.db();
    await runTransaction<void>(db, store, 'readwrite', (tx, done) => {
      const request = tx.objectStore(store).delete(key);
      request.onsuccess = () => done(undefined);
    });
  }

  async getAllByIndex<T>(store: string, index: string, query: IDBValidKey | IDBKeyRange): Promise<T[]> {
    const db = await this.db();
    return runTransaction<T[]>(db, store, 'readonly', (tx, done) => {
      const request = tx.objectStore(store).index(index).getAll(query);
      request.onsuccess = () => done((request.result as T[] | undefined) ?? []);
    });
  }

  async readLifecycle(): Promise<LifecycleStateRecord | null> {
    return this.get<LifecycleStateRecord>('lifecycle', 'lifecycle');
  }

  async writeLifecycle(record: LifecycleStateRecord): Promise<void> {
    await this.put('lifecycle', record);
  }

  /**
   * Writes one private record only when the caller's subject + lifecycle epoch
   * still match the authoritative owner. A stale account or epoch aborts the
   * whole transaction instead of leaking a write across ownership changes.
   */
  async putAccountRecord<T>(subject: string, epoch: number, store: string, value: T): Promise<void> {
    assertRecordSubject(subject, value);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', store], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        tx.objectStore(store).put(value as unknown as IDBValidKey);
        done(undefined);
      });
    });
  }

  /**
   * Commits a local reader edit and its outbox operation in one transaction.
   * An abort leaves neither half an edit nor half an outbox record.
   */
  async commitEditWithOutbox(input: CommitEditInput<unknown>): Promise<void> {
    assertRecordSubject(input.subject, input.record);
    assertRecordSubject(input.subject, input.operation);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'readerRecords', 'outbox'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, input.subject, input.epoch, fail, () => {
        tx.objectStore('readerRecords').put(input.record as unknown as IDBValidKey);
        tx.objectStore('outbox').put(input.operation as unknown as IDBValidKey);
        done(undefined);
      });
    });
  }

  /** Appends an outbox operation alone, still fenced by owner + epoch. */
  async commitOutbox(subject: string, epoch: number, operation: unknown): Promise<void> {
    assertRecordSubject(subject, operation);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'outbox'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        tx.objectStore('outbox').put(operation as unknown as IDBValidKey);
        done(undefined);
      });
    });
  }

  /**
   * Records a durable acknowledgement and removes the queued operation in one
   * transaction. A crash before `oncomplete` leaves the operation replayable.
   */
  async acknowledgeOperation(subject: string, epoch: number, outboxId: string, receipt: unknown): Promise<void> {
    assertRecordSubject(subject, receipt);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'outbox', 'receipts'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        tx.objectStore('receipts').put(receipt as unknown as IDBValidKey);
        tx.objectStore('outbox').delete(outboxId);
        done(undefined);
      });
    });
  }

  async compareAndSetLease(name: string, expectedToken: number | null, next: LeaseRecord | null): Promise<boolean> {
    const db = await this.db();
    return runTransaction<boolean>(db, 'leases', 'readwrite', (tx, done) => {
      const store = tx.objectStore('leases');
      const request = store.get(name);
      request.onsuccess = () => {
        const current = request.result as LeaseRecord | undefined;
        const token = current?.fencingToken ?? null;
        if (token !== expectedToken) {
          done(false);
          return;
        }
        if (next) store.put(next);
        else store.delete(name);
        done(true);
      };
    });
  }

  /** Removes every private record for one subject without touching others. */
  async clearSubject(subject: string): Promise<void> {
    const db = await this.db();
    await runTransaction<void>(db, [...PRIVATE_SUBJECT_STORES], 'readwrite', (tx, done) => {
      let remaining = PRIVATE_SUBJECT_STORES.length;
      const finish = () => {
        remaining -= 1;
        if (remaining === 0) done(undefined);
      };
      for (const name of PRIVATE_SUBJECT_STORES) {
        const request = tx.objectStore(name).index('subject').openCursor(IDBKeyRange.only(subject));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
          }
          finish();
        };
      }
    });
  }
}

/** Portable fencing-token lease persistence backed by the `leases` store. */
export function createIndexedDbLeasePersistence(database?: OfflineDatabase): LeasePersistence {
  const db = database ?? new OfflineDatabase();
  return {
    read: (name) => db.get<LeaseRecord>('leases', name),
    compareAndSet: (name, expected, next) => db.compareAndSetLease(name, expected, next),
  };
}
