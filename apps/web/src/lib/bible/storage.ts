export interface KVStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

class IndexedDBKV implements KVStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('transformlit-bible', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('kv')) {
          req.result.createObjectStore('kv');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(req.error?.message ?? 'IndexedDB request failed'));
    });
    return this.dbPromise;
  }

  private tx<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.db().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction('kv', mode);
          const req = op(tx.objectStore('kv'));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(new Error(req.error?.message ?? 'IndexedDB request failed'));
        }),
    );
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.tx('readonly', (s) => s.get(key) as IDBRequest<T>);
    return value ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.tx('readwrite', (s) => s.put(value, key));
  }

  async del(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key));
  }
}

class MemoryKV implements KVStore {
  private readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

let kvStore: KVStore | null = null;

export function setKVStore(store: KVStore): void {
  kvStore = store;
}

export function getKVStore(): KVStore {
  kvStore ??= typeof indexedDB === 'undefined' ? new MemoryKV() : new IndexedDBKV();
  return kvStore;
}

// ── Prefs (localStorage) ─────────────────────────────────────────────

const PREFS_KEY = 'bible-prefs';

export interface BiblePrefs {
  translation?: string;
}

export function loadPrefs(): BiblePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as BiblePrefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: BiblePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota/private-mode errors
  }
}