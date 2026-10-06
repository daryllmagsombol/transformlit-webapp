import {
  classifyStorageError,
  keyBelongsToSubject,
  type BibleChapterRecord,
  type BookPageRecord,
  type BookVersionRecord,
  type ConflictCopyRecord,
  type DownloadManifestRecord,
  type DeferredLogoutRecord,
  type LifecycleBarrierRecord,
  type LifecycleStateRecord,
  type LeaseRecord,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OfflineStorageError,
  SchemaVersionError,
  StorageUnavailableError,
  SubjectMismatchError,
  TransactionAbortedError,
  bibleChapterKey,
  qualifyKey,
} from './contracts';
import type { LeasePersistence } from './coordination';
import type { LifecyclePersistence } from './account-lifecycle';

export {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  bookKey,
  bookPageKey,
  bookVersionKey,
  bibleChapterKey,
  qualifyKey,
} from './contracts';

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

/** Creates the store/index layout, skipping anything the database already has. */
function ensureStores(db: IDBDatabase): void {
  for (const schema of OFFLINE_STORES) {
    // Never re-create a present store: on a version bump the upgrade runs over
    // the existing database, and `createObjectStore` on an existing name throws
    // `ConstraintError`, aborting the whole upgrade and bricking the offline DB.
    if (db.objectStoreNames?.contains(schema.name)) continue;
    const store = db.createObjectStore(schema.name, { keyPath: schema.keyPath });
    for (const index of schema.indexes ?? []) {
      store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
    }
  }
}

/**
 * Additive, ordered schema migrations. Each entry runs when opening a database
 * whose stored version is strictly below `version`, so a future bump replays
 * only the steps it has not applied. Version 1 is the initial layout.
 */
const SCHEMA_MIGRATIONS: readonly { readonly version: number; readonly apply: (db: IDBDatabase) => void }[] = [
  { version: 1, apply: ensureStores },
];

/** Applies every migration newer than `oldVersion`, idempotently. */
function createSchema(db: IDBDatabase, oldVersion: number): void {
  for (const migration of SCHEMA_MIGRATIONS) {
    if (oldVersion < migration.version) migration.apply(db);
  }
}

/**
 * The highest retained content version that is genuinely openable: its stored
 * descriptor is `READY` and every declared page is present and verified.
 *
 * `retainVersions` is derived from annotation/pending-op references and can name
 * a version with no stored row or an interrupted `STAGED` row. Such a version
 * must never be promoted or surfaced, so it is excluded here and the manifest
 * falls back to a recoverable state instead of advertising a phantom READY.
 */
function highestCompleteReadyRetained(
  versions: readonly BookVersionRecord[],
  pages: readonly BookPageRecord[],
  retain: ReadonlySet<number>,
): number | null {
  const verifiedPages = new Map<number, number>();
  for (const page of pages) {
    if (!retain.has(page.contentVersion) || !page.verified) continue;
    verifiedPages.set(page.contentVersion, (verifiedPages.get(page.contentVersion) ?? 0) + 1);
  }
  let highest: number | null = null;
  for (const version of versions) {
    if (!retain.has(version.contentVersion) || version.status !== 'READY') continue;
    if ((verifiedPages.get(version.contentVersion) ?? 0) < version.totalPages) continue;
    if (highest === null || version.contentVersion > highest) highest = version.contentVersion;
  }
  return highest;
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

    request.onupgradeneeded = (event) => {
      const oldVersion = (event as IDBVersionChangeEvent | undefined)?.oldVersion ?? 0;
      createSchema(request.result, oldVersion);
    };
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

/**
 * One atomic conflict-resolution commit: new/replacement outbox operations are
 * upserted before `removeIds` are removed, and the conflict copy is marked
 * resolved, all in a single fenced transaction.
 */
export interface ConflictResolutionCommit {
  subject: string;
  epoch: number;
  upserts: readonly unknown[];
  removeIds: readonly string[];
  conflict: ConflictCopyRecord | null;
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
    if (state?.subject !== subject) {
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
  private dbPromise: Promise<IDBDatabase> | null;

  constructor(db?: IDBDatabase) {
    // No asynchronous work in the constructor (Sonar S7059): the database is
    // opened lazily on first use. A caller-provided connection is used as-is.
    this.dbPromise = db ? Promise.resolve(db) : null;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openOfflineDatabase();
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

  /** Durable sign-out/switch barrier; read on restart by the lifecycle service. */
  async readBarrier(): Promise<LifecycleBarrierRecord | null> {
    return this.get<LifecycleBarrierRecord>('lifecycle', 'lifecycle-barrier');
  }

  async writeBarrier(record: LifecycleBarrierRecord): Promise<void> {
    await this.put('lifecycle', record);
  }

  async clearBarrier(): Promise<void> {
    await this.delete('lifecycle', 'lifecycle-barrier');
  }

  /**
   * Durable deferred-logout marker: written when the remote session could not be
   * invalidated (offline/failed/timed-out). It blocks every activation path
   * until the old session is confirmed invalidated, surviving restart.
   */
  async readDeferredLogout(): Promise<DeferredLogoutRecord | null> {
    return this.get<DeferredLogoutRecord>('lifecycle', 'deferred-logout');
  }

  async writeDeferredLogout(record: DeferredLogoutRecord): Promise<void> {
    await this.put('lifecycle', record);
  }

  async clearDeferredLogout(): Promise<void> {
    await this.delete('lifecycle', 'deferred-logout');
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
        tx.objectStore('readerRecords').put(input.record);
        tx.objectStore('outbox').put(input.operation);
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
        tx.objectStore('outbox').put(operation);
        done(undefined);
      });
    });
  }

  /**
   * Records a durable acknowledgement and removes the queued operation in one
   * transaction. A crash before `oncomplete` leaves the operation replayable.
   *
   * `successors` (optional) are rebased successor operations that MUST commit in
   * the SAME transaction as the receipt + removal, so a crash can never leave a
   * removed predecessor beside a successor still carrying a stale base revision.
   */
  async acknowledgeOperation(
    subject: string,
    epoch: number,
    outboxId: string,
    receipt: unknown,
    successors: readonly unknown[] = [],
  ): Promise<void> {
    assertRecordSubject(subject, receipt);
    for (const successor of successors) assertRecordSubject(subject, successor);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'outbox', 'receipts'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        tx.objectStore('receipts').put(receipt);
        const outbox = tx.objectStore('outbox');
        for (const successor of successors) outbox.put(successor);
        outbox.delete(outboxId);
        done(undefined);
      });
    });
  }

  /**
   * Atomically upserts rebased successors and removes discarded predecessors in
   * one fenced transaction. Used by conflict discard so a dependent chain is
   * never half-removed (successor left runnable with a stale base revision).
   */
  async commitOutboxChanges(
    subject: string,
    epoch: number,
    upserts: readonly unknown[],
    removeIds: readonly string[],
  ): Promise<void> {
    for (const upsert of upserts) assertRecordSubject(subject, upsert);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'outbox'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        const outbox = tx.objectStore('outbox');
        for (const upsert of upserts) outbox.put(upsert);
        for (const id of removeIds) outbox.delete(id);
        done(undefined);
      });
    });
  }

  /**
   * Stores a durable acknowledgement receipt WITHOUT removing the operation.
   * Used for CONFLICT receipts: the operation stays queued (blocking its
   * successors) until the user resolves it, while the receipt records the
   * durable server conflict result. Still fenced by subject + epoch.
   */
  async recordReceipt(subject: string, epoch: number, receipt: unknown): Promise<void> {
    assertRecordSubject(subject, receipt);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'receipts'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        tx.objectStore('receipts').put(receipt);
        done(undefined);
      });
    });
  }

  /**
   * Writes one download record (manifest, version, page, or chapter) only when
   * the caller's subject + lifecycle epoch still match the authoritative owner.
   * Used for the short per-item writes during staging; the actual readiness
   * publish is a separate, atomic multi-store transaction.
   */
  async putDownloadRecord<T>(subject: string, epoch: number, store: string, value: T): Promise<void> {
    await this.putAccountRecord(subject, epoch, store, value);
  }

  /**
   * Writes a batch of download records for the same store in one short, fenced
   * transaction. Callers must not hold this across network I/O: each chunk is
   * committed and released before the next fetch begins.
   */
  async putDownloadRecords<T>(subject: string, epoch: number, store: string, values: readonly T[]): Promise<void> {
    if (values.length === 0) return;
    for (const value of values) assertRecordSubject(subject, value);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', store], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        const objectStore = tx.objectStore(store);
        for (const value of values) objectStore.put(value as unknown as IDBValidKey);
        done(undefined);
      });
    });
  }

  /**
   * Persists a Bible chapter (content + metadata + provenance) in one fenced
   * transaction. Rights are checked by the caller before this is reached.
   */
  async putBibleChapter(subject: string, epoch: number, record: BibleChapterRecord): Promise<void> {
    await this.putDownloadRecord(subject, epoch, 'bibleChapters', record);
  }

  async getBibleChapter(
    subject: string,
    translation: string,
    book: string,
    chapter: number,
  ): Promise<BibleChapterRecord | null> {
    return this.get<BibleChapterRecord>('bibleChapters', bibleChapterKey(subject, translation, book, chapter));
  }

  /**
   * Atomically publishes a verified Bible chapter: the chapter content and its
   * ready manifest land in one fenced transaction, so a chapter can never be
   * readable without a ready marker or vice versa.
   */
  async publishBibleChapter(
    subject: string,
    epoch: number,
    chapter: BibleChapterRecord,
    manifest: DownloadManifestRecord,
  ): Promise<void> {
    assertRecordSubject(subject, chapter);
    assertRecordSubject(subject, manifest);
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'bibleChapters', 'downloadManifests'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        tx.objectStore('bibleChapters').put(chapter as unknown as IDBValidKey);
        tx.objectStore('downloadManifests').put(manifest as unknown as IDBValidKey);
        done(undefined);
      });
    });
  }

  /** Every stored page of a pinned book version (used to re-verify on retry). */
  async getBookPages(subject: string, bookId: string, contentVersion: number): Promise<BookPageRecord[]> {
    return this.getAllByIndex<BookPageRecord>(
      'bookPages',
      'subjectBookVersion',
      IDBKeyRange.bound(
        [subject, bookId, contentVersion],
        [subject, bookId, contentVersion, Number.MAX_SAFE_INTEGER],
      ),
    );
  }

  /**
   * Atomically publishes a verified book version: marks the new version ready +
   * active, demotes the prior version (if any) to inactive, and repoints the
   * manifest's `activeVersion`. A failure anywhere aborts the whole
   * transaction, so the previous complete version stays active.
   */
  async publishBookVersion(
    subject: string,
    epoch: number,
    version: BookVersionRecord,
    manifest: DownloadManifestRecord,
  ): Promise<void> {
    assertRecordSubject(subject, version);
    assertRecordSubject(subject, manifest);
    const db = await this.db();
    await runTransaction<void>(
      db,
      ['lifecycle', 'bookVersions', 'downloadManifests'],
      'readwrite',
      (tx, done, fail) => {
        guardWrite(tx, subject, epoch, fail, () => {
          const versions = tx.objectStore('bookVersions');
          const request = versions.index('subjectBookVersion').getAll(
            IDBKeyRange.bound([subject, version.bookId], [subject, version.bookId, Number.MAX_SAFE_INTEGER]),
          );
          request.onsuccess = () => {
            for (const existing of (request.result as BookVersionRecord[] | undefined) ?? []) {
              if (existing.id === version.id) continue;
              if (existing.active) versions.put({ ...existing, active: false });
            }
            versions.put(version as unknown as IDBValidKey);
            tx.objectStore('downloadManifests').put(manifest as unknown as IDBValidKey);
            done(undefined);
          };
          request.onerror = () => {
            fail(request.error ?? new OfflineStorageError('Could not read book versions'));
            tx.abort();
          };
        });
      },
    );
  }

  async getBookVersion(subject: string, bookId: string, contentVersion: number): Promise<BookVersionRecord | null> {
    return this.get<BookVersionRecord>(
      'bookVersions',
      qualifyKey(subject, 'bookversion', bookId, contentVersion),
    );
  }

  /** The single ready+active version currently exposed offline for a book. */
  async getActiveBookVersion(subject: string, bookId: string): Promise<BookVersionRecord | null> {
    const versions = await this.getAllByIndex<BookVersionRecord>(
      'bookVersions',
      'subjectBookVersion',
      IDBKeyRange.bound([subject, bookId], [subject, bookId, Number.MAX_SAFE_INTEGER]),
    );
    return versions.find((version) => version.active && version.status === 'READY') ?? null;
  }

  /**
   * Atomically commits an explicit conflict resolution: upserts the newly
   * planned operations FIRST, then removes the replaced predecessors, then
   * marks the conflict copy resolved — all in ONE transaction. A fault at ANY
   * point aborts the whole transaction, so a crash can never remove the
   * conflicted operation without first persisting its replacement (which would
   * silently lose the retargeted edit and its rebased descendants). Re-running
   * the resolution is therefore always safe.
   */
  async commitConflictResolution(input: ConflictResolutionCommit): Promise<void> {
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'outbox', 'conflicts'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, input.subject, input.epoch, fail, () => {
        const outbox = tx.objectStore('outbox');
        // Upserts FIRST (new operations / rebased successors), then removals.
        for (const operation of input.upserts) outbox.put(operation);
        for (const id of input.removeIds) outbox.delete(id);
        if (input.conflict !== null) {
          tx.objectStore('conflicts').put(input.conflict as unknown as IDBValidKey);
        }
        done(undefined);
      });
    });
  }

  /**
   * Removes a whole book download's content (version descriptor + pages +
   * manifest) for one subject, EXCEPT versions in `retainVersions`. A version
   * still referenced by a saved/pending annotation is pinned so its anchor is
   * never reinterpreted against newer content. It never touches
   * `readerRecords`, `outbox`, `receipts`, `tombstones`, or `conflicts`, so
   * annotations and pending edits survive a removal.
   */
  async removeBookDownload(
    subject: string,
    epoch: number,
    bookId: string,
    manifestId: string,
    retainVersions: readonly number[] = [],
  ): Promise<void> {
    const retain = new Set(retainVersions);
    const range = IDBKeyRange.bound([subject, bookId], [subject, bookId, Number.MAX_SAFE_INTEGER]);
    const versions = await this.getAllByIndex<BookVersionRecord>('bookVersions', 'subjectBookVersion', range);
    const pages = await this.getAllByIndex<BookPageRecord>('bookPages', 'subjectBookVersion', range);
    const db = await this.db();
    await runTransaction<void>(
      db,
      ['lifecycle', 'downloadManifests', 'bookVersions', 'bookPages'],
      'readwrite',
      (tx, done, fail) => {
        guardWrite(tx, subject, epoch, fail, () => {
          const versionStore = tx.objectStore('bookVersions');
          const pageStore = tx.objectStore('bookPages');
          // Only a retained version whose stored descriptor is genuinely READY
          // may become the single active/READY version. `retainVersions` also
          // carries version numbers that have no stored row (or an interrupted
          // STAGED row) because a saved annotation/pending op references them;
          // promoting one of those would expose unverified content through
          // `getActiveBookVersion()` and bypass `verifyCompleteBook`.
          const pinned = highestCompleteReadyRetained(versions, pages, retain);
          for (const version of versions) {
            if (!retain.has(version.contentVersion)) {
              versionStore.delete(version.id);
              continue;
            }
            const shouldBeActive = version.contentVersion === pinned;
            versionStore.put({ ...version, active: shouldBeActive });
          }
          for (const page of pages) {
            if (!retain.has(page.contentVersion)) pageStore.delete(page.id);
          }
          this.handleRemovalManifest(tx, manifestId, retain, pinned);
          done(undefined);
        });
      },
    );
  }

  /**
   * Deletes the manifest, or repoints it at the highest complete pinned version.
   * When no retained version is genuinely openable, the manifest is moved to a
   * recoverable `INTERRUPTED` state with a null `activeVersion` rather than
   * advertising a READY version whose content is missing or unverified.
   */
  private handleRemovalManifest(
    tx: IDBTransaction,
    manifestId: string,
    retain: ReadonlySet<number>,
    pinned: number | null,
  ): void {
    const manifests = tx.objectStore('downloadManifests');
    if (retain.size === 0) {
      manifests.delete(manifestId);
      return;
    }
    const request = manifests.get(manifestId);
    request.onsuccess = () => {
      const manifest = request.result as DownloadManifestRecord | undefined;
      if (!manifest) return;
      if (pinned === null) {
        manifests.put({ ...manifest, status: 'INTERRUPTED', activeVersion: null });
        return;
      }
      manifests.put({ ...manifest, status: 'READY', activeVersion: pinned });
    };
  }

  /** Removes one saved Bible chapter and its manifest; never touches reader state. */
  async removeBibleChapter(
    subject: string,
    epoch: number,
    translation: string,
    book: string,
    chapter: number,
    manifestId: string,
  ): Promise<void> {
    const db = await this.db();
    await runTransaction<void>(db, ['lifecycle', 'downloadManifests', 'bibleChapters'], 'readwrite', (tx, done, fail) => {
      guardWrite(tx, subject, epoch, fail, () => {
        tx.objectStore('bibleChapters').delete(bibleChapterKey(subject, translation, book, chapter));
        tx.objectStore('downloadManifests').delete(manifestId);
        done(undefined);
      });
    });
  }

  async getDownloadManifest(subject: string, key: string): Promise<DownloadManifestRecord | null> {
    return this.get<DownloadManifestRecord>('downloadManifests', key);
  }

  async listDownloadManifests(subject: string): Promise<DownloadManifestRecord[]> {
    return this.getAllByIndex<DownloadManifestRecord>('downloadManifests', 'subject', subject);
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

/**
 * Lifecycle persistence backed by the IndexedDB `lifecycle` store. Used when a
 * real IndexedDB is available so ownership epoch and the sign-out barrier
 * survive a restart.
 */
export function createIndexedDbLifecyclePersistence(database?: OfflineDatabase): LifecyclePersistence {
  const db = database ?? new OfflineDatabase();
  return {
    readState: () => db.readLifecycle(),
    writeState: (record) => db.writeLifecycle(record),
    readBarrier: () => db.readBarrier(),
    writeBarrier: (record) => db.writeBarrier(record),
    clearBarrier: () => db.clearBarrier(),
    readDeferredLogout: () => db.readDeferredLogout(),
    writeDeferredLogout: (record) => db.writeDeferredLogout(record),
    clearDeferredLogout: () => db.clearDeferredLogout(),
  };
}

/** In-memory lifecycle persistence for SSR/jsdom where IndexedDB is absent. */
export function createMemoryLifecyclePersistence(): LifecyclePersistence {
  let state: LifecycleStateRecord | null = null;
  let barrier: LifecycleBarrierRecord | null = null;
  let deferred: DeferredLogoutRecord | null = null;
  return {
    readState: () => Promise.resolve(state),
    writeState: (record) => {
      state = record;
      return Promise.resolve();
    },
    readBarrier: () => Promise.resolve(barrier),
    writeBarrier: (record) => {
      barrier = record;
      return Promise.resolve();
    },
    clearBarrier: () => {
      barrier = null;
      return Promise.resolve();
    },
    readDeferredLogout: () => Promise.resolve(deferred),
    writeDeferredLogout: (record) => {
      deferred = record;
      return Promise.resolve();
    },
    clearDeferredLogout: () => {
      deferred = null;
      return Promise.resolve();
    },
  };
}
