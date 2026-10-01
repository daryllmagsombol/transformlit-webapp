import { OFFLINE_STORES } from '../../src/lib/offline/database';

/**
 * A small, stateful in-memory IndexedDB used by the download-manager specs.
 *
 * Unlike `fake-indexeddb` (which is not a dependency), this models only what
 * `runTransaction`/`OfflineDatabase` actually exercise: keyPath stores, simple
 * and compound indexes, `getAll`, and `openCursor` with in-transaction delete.
 * Reads see uncommitted writes within the same transaction (matching IDB), an
 * `abort()` discards the working copy, and `oncomplete` fires only after every
 * queued request has settled.
 *
 * The helper also exposes failure injection used to prove quota handling:
 * `failOnStores` makes a `put` into the named store fail with a
 * `QuotaExceededError` DOMException.
 */

type Handler = ((event?: unknown) => void) | null;

class MemoryRequest {
  result: unknown = undefined;
  error: unknown = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
}

class MemoryCursor {
  constructor(
    private readonly onDelete: () => void,
    private readonly onContinue: () => void,
  ) {}

  delete(): void {
    this.onDelete();
  }

  continue(): void {
    this.onContinue();
  }
}

type StoredValue = Record<string, unknown>;
type Working = Map<string, Map<string, StoredValue>>;

function normalizeKey(key: unknown): Array<string | number> {
  return Array.isArray(key) ? (key as Array<string | number>) : [key as string | number];
}

function indexKey(value: StoredValue, keyPath: string | string[]): Array<string | number> {
  const parts = Array.isArray(keyPath) ? keyPath : [keyPath];
  return parts.map((part) => value[part] as string | number);
}

function keyMatches(candidate: Array<string | number>, query: unknown): boolean {
  if (query === undefined) return true;
  const wanted = normalizeKey(query);
  if (wanted.length !== candidate.length) return false;
  return wanted.every((part, index) => part === candidate[index]);
}

export class MemoryKeyRange {
  private constructor(
    private readonly lower: Array<string | number> | null,
    private readonly upper: Array<string | number> | null,
  ) {}

  static only(key: unknown): MemoryKeyRange {
    const wanted = normalizeKey(key);
    return new MemoryKeyRange(wanted, wanted);
  }

  static bound(lower: unknown, upper: unknown): MemoryKeyRange {
    return new MemoryKeyRange(normalizeKey(lower), normalizeKey(upper));
  }

  matches(candidate: Array<string | number>): boolean {
    return this.includes(candidate);
  }

  private includes(candidate: Array<string | number>): boolean {
    if (this.lower && compareKeys(candidate, this.lower) < 0) return false;
    if (this.upper && compareKeys(candidate, this.upper) > 0) return false;
    return true;
  }
}

function compareKeys(left: Array<string | number>, right: Array<string | number>): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    return a < b ? -1 : 1;
  }
  return left.length - right.length;
}

function isRange(query: unknown): query is MemoryKeyRange {
  return query instanceof MemoryKeyRange;
}

/** Global `IDBKeyRange` stand-in understood by this fake. */
export const memoryIdbKeyRange = {
  only: (key: unknown) => MemoryKeyRange.only(key),
  bound: (lower: unknown, upper: unknown) => MemoryKeyRange.bound(lower, upper),
  lowerBound: (lower: unknown) => MemoryKeyRange.bound(lower, []),
  upperBound: (upper: unknown) => MemoryKeyRange.bound([], upper),
};

class MemoryIndex {
  constructor(
    private readonly transaction: MemoryTransaction,
    private readonly storeName: string,
    private readonly keyPath: string | string[],
  ) {}

  getAll(query?: unknown): MemoryRequest {
    const request = new MemoryRequest();
    const rows = [...this.transaction.workingStore(this.storeName).values()];
    const matches = rows.filter((row) => {
      const candidate = indexKey(row, this.keyPath);
      return isRange(query) ? query.matches(candidate) : keyMatches(candidate, query);
    });
    this.transaction.enqueue(request, () => matches, null);
    return request;
  }

  openCursor(query?: unknown): MemoryRequest {
    const request = new MemoryRequest();
    const rows = [...this.transaction.workingStore(this.storeName).entries()].filter(([, row]) => {
      const candidate = indexKey(row, this.keyPath);
      return isRange(query) ? query.matches(candidate) : keyMatches(candidate, query);
    });
    this.transaction.enqueueCursor(request, this.storeName, rows);
    return request;
  }
}

class MemoryObjectStore {
  constructor(
    private readonly transaction: MemoryTransaction,
    private readonly name: string,
  ) {}

  private get keyPath(): string {
    return OFFLINE_STORES.find((store) => store.name === this.name)?.keyPath ?? 'id';
  }

  get(key: unknown): MemoryRequest {
    const request = new MemoryRequest();
    const row = this.transaction.workingStore(this.name).get(String(key));
    this.transaction.enqueue(request, () => row ?? null, null);
    return request;
  }

  put(value: StoredValue): MemoryRequest {
    const request = new MemoryRequest();
    const failure = this.transaction.failureFor(this.name, value);
    if (failure) {
      this.transaction.enqueue(request, () => undefined, failure);
      return request;
    }
    const key = String(value[this.keyPath]);
    this.transaction.workingStore(this.name).set(key, value);
    this.transaction.enqueue(request, () => undefined, null);
    return request;
  }

  delete(key: unknown): MemoryRequest {
    const request = new MemoryRequest();
    this.transaction.workingStore(this.name).delete(String(key));
    this.transaction.enqueue(request, () => undefined, null);
    return request;
  }

  index(name: string): MemoryIndex {
    const schema = OFFLINE_STORES.find((store) => store.name === this.name);
    const index = schema?.indexes?.find((candidate) => candidate.name === name);
    return new MemoryIndex(this.transaction, this.name, index?.keyPath ?? name);
  }
}

/**
 * A transaction over the live stores with snapshot rollback.
 *
 * Unlike a real IndexedDB transaction this does not lock; concurrent
 * `readwrite` transactions on the same store would normally serialize, but the
 * download manager is the only writer in these specs. Operating on live stores
 * (rather than a private copy) is what makes concurrent writes to *different*
 * keys additive instead of clobbering each other on commit. `abort()` restores
 * the pre-transaction snapshot, preserving rollback semantics.
 */
class MemoryTransaction {
  readonly oncomplete: Handler = null;
  readonly onabort: Handler = null;
  readonly onerror: Handler = null;
  error: unknown = null;

  private readonly live: Working = new Map();
  private readonly snapshots = new Map<string, Map<string, StoredValue>>();
  private pending = 0;
  private finished = false;
  private aborted = false;

  constructor(
    private readonly database: MemoryDatabase,
    storeNames: string | string[],
    readonly mode: string,
  ) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const name of names) {
      const store = this.database.rawStore(name);
      this.live.set(name, store);
      this.snapshots.set(name, new Map(store));
    }
  }

  workingStore(name: string): Map<string, StoredValue> {
    const store = this.live.get(name);
    if (!store) {
      const created = new Map<string, StoredValue>();
      this.live.set(name, created);
      return created;
    }
    return store;
  }

  failureFor(storeName: string, value?: StoredValue): unknown {
    return this.database.shouldFail()(storeName, value);
  }

  objectStore(name: string): MemoryObjectStore {
    return new MemoryObjectStore(this, name);
  }

  enqueue(request: MemoryRequest, resolve: () => unknown, failure: unknown): void {
    this.pending += 1;
    queueMicrotask(() => {
      if (this.finished) return;
      if (failure) {
        this.pending -= 1;
        request.error = failure;
        request.onerror?.(failure);
        this.abortNow(failure);
        return;
      }
      request.result = resolve();
      request.onsuccess?.({});
      this.pending -= 1;
      this.tick();
    });
  }

  enqueueCursor(
    request: MemoryRequest,
    storeName: string,
    rows: Array<[string, StoredValue]>,
  ): void {
    this.pending += 1;
    let index = 0;
    const advance = () => {
      if (this.finished) return;
      if (index >= rows.length) {
        request.result = null;
        request.onsuccess?.({});
        this.pending -= 1;
        this.tick();
        return;
      }
      const [key, value] = rows[index];
      const cursor = new MemoryCursor(
        () => this.workingStore(storeName).delete(key),
        () => {
          index += 1;
          queueMicrotask(advance);
        },
      );
      request.result = cursor;
      request.onsuccess?.({});
    };
    queueMicrotask(advance);
  }

  abort(): void {
    this.abortNow(this.error ?? new Error('aborted'));
  }

  private abortNow(reason: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.aborted = true;
    this.error = reason;
    // Roll every touched store back to its pre-transaction snapshot.
    for (const [name, snapshot] of this.snapshots) {
      const store = this.database.rawStore(name);
      store.clear();
      for (const [key, value] of snapshot) store.set(key, value);
    }
    queueMicrotask(() => this.onabort?.({}));
  }

  private tick(): void {
    if (this.finished || this.aborted || this.pending > 0) return;
    this.finished = true;
    queueMicrotask(() => this.oncomplete?.({}));
  }
}

class MemoryDatabase {
  private readonly stores = new Map<string, Map<string, StoredValue>>();
  private shouldFailImpl: (storeName: string, value?: StoredValue) => unknown = () => null;

  constructor() {
    for (const schema of OFFLINE_STORES) {
      this.stores.set(schema.name, new Map());
    }
  }

  rawStore(name: string): Map<string, StoredValue> {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    return store;
  }

  shouldFail(): (storeName: string, value?: StoredValue) => unknown {
    return this.shouldFailImpl;
  }

  setFailure(failure: (storeName: string, value?: StoredValue) => unknown): void {
    this.shouldFailImpl = failure;
  }

  commit(working: Working): void {
    for (const [name, values] of working) {
      this.stores.set(name, new Map(values));
    }
  }

  transaction(storeNames: string | string[], mode: string): MemoryTransaction {
    return new MemoryTransaction(this, storeNames, mode);
  }

  createObjectStore(): { createIndex: () => void } {
    return { createIndex: () => undefined };
  }

  close(): void {
    return undefined;
  }
}

export interface MemoryIndexedDb {
  readonly indexedDB: { open: (name: string, version?: number) => unknown };
  /** Make `put` into any store in the set fail with a quota DOMException. */
  failStorePuts(storeNames: readonly string[]): void;
  /** Fail only puts matching a predicate (e.g. a specific version id). */
  failPutWhen(predicate: (storeName: string, value: StoredValue) => boolean): void;
  /** Clear injected failures. */
  clearFailures(): void;
}

export function createMemoryIndexedDb(): MemoryIndexedDb {
  const database = new MemoryDatabase();
  const open = () => {
    const request = new MemoryRequest() as unknown as {
      result: MemoryDatabase;
      error: unknown;
      onupgradeneeded: Handler;
      onsuccess: Handler;
      onerror: Handler;
      onblocked: Handler;
    };
    request.result = database;
    request.error = null;
    request.onupgradeneeded = null;
    request.onsuccess = null;
    request.onerror = null;
    request.onblocked = null;
    queueMicrotask(() => {
      request.onupgradeneeded?.({});
      request.onsuccess?.({});
    });
    return request;
  };

  let failing: ReadonlySet<string> = new Set();
  let predicate: ((storeName: string, value: StoredValue) => boolean) | null = null;
  database.setFailure((storeName, value) => {
    if (predicate && value && predicate(storeName, value)) {
      return new DOMException(`quota exceeded writing ${storeName}`, 'QuotaExceededError');
    }
    if (!failing.has(storeName)) return null;
    return new DOMException(`quota exceeded writing ${storeName}`, 'QuotaExceededError');
  });

  return {
    indexedDB: { open },
    failStorePuts: (storeNames) => {
      failing = new Set(storeNames);
    },
    failPutWhen: (next) => {
      predicate = next;
    },
    clearFailures: () => {
      failing = new Set();
      predicate = null;
    },
  };
}
