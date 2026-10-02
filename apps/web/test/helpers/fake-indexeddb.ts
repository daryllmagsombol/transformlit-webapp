/**
 * A deliberately tiny fake of the IndexedDB surface used by
 * `openOfflineDatabase()` and `runTransaction()`. jsdom (and Node) lack real
 * IndexedDB, so this exercises the open/error/blocked paths without adding a
 * dependency. It is NOT a general IndexedDB implementation; it only models the
 * request events the offline database module observes.
 */

export interface FakeOpenRequest {
  result: IDBDatabase;
  error: Error | null;
  onupgradeneeded: ((event: unknown) => void) | null;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onblocked: ((event: unknown) => void) | null;
}

export interface FakeIndexedDbOptions {
  /** Error attached to an errored open; `name` drives `VersionError` mapping. */
  openError?: Error | null;
  /** Fire `onblocked` instead of `onsuccess`. */
  blocked?: boolean;
  /** Skip firing `onupgradeneeded` (existing database). */
  skipUpgrade?: boolean;
}

export interface FakeIndexedDb {
  indexedDB: { open: (name: string, version?: number) => FakeOpenRequest };
  openMock: jest.Mock;
}

function makeFakeDatabase(): IDBDatabase {
  const database = {
    close: jest.fn(),
    createObjectStore: jest.fn(() => ({ createIndex: jest.fn() })),
  };
  return database as unknown as IDBDatabase;
}

export function createFakeIndexedDb(options: FakeIndexedDbOptions = {}): FakeIndexedDb {
  const request: FakeOpenRequest = {
    result: makeFakeDatabase(),
    error: options.openError ?? null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  };

  const openMock = jest.fn(() => {
    queueMicrotask(() => {
      if (!options.skipUpgrade && request.onupgradeneeded) request.onupgradeneeded({});
      if (options.blocked) {
        // Real IndexedDB fires `blocked` first and never fires `success`.
        request.onblocked?.({});
        return;
      }
      if (request.error) request.onerror?.({});
      else if (request.onsuccess) request.onsuccess({});
    });
    return request;
  });

  return {
    indexedDB: { open: openMock as unknown as (name: string, version?: number) => FakeOpenRequest },
    openMock,
  };
}
