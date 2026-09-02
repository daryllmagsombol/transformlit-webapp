import type { KVStore } from './storage';

/**
 * A minimal synchronous fake of the IndexedDB surface that storage.ts uses
 * (open → objectStoreNames/transaction → store.get/put/delete). Request
 * handlers auto-fire on assignment via a microtask, mirroring IndexedDB's
 * async completion while keeping the test deterministic.
 */
function makeFakeIndexedDB(opts: { failOpen?: boolean; failOps?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const storeNames = { hasStore: false };

  function makeReq(error: Error | null, fireUpgrade = false) {
    const handlers: {
      onupgradeneeded: ((e: unknown) => void) | null;
      onsuccess: ((e: unknown) => void) | null;
      onerror: ((e: unknown) => void) | null;
    } = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    };
    return {
      result: undefined as unknown,
      error,
      get onupgradeneeded() {
        return handlers.onupgradeneeded;
      },
      set onupgradeneeded(h: ((e: unknown) => void) | null) {
        handlers.onupgradeneeded = h;
        if (h && fireUpgrade) queueMicrotask(() => h({}));
      },
      get onsuccess() {
        return handlers.onsuccess;
      },
      set onsuccess(h: ((e: unknown) => void) | null) {
        handlers.onsuccess = h;
        if (h && !error) queueMicrotask(() => h({}));
      },
      get onerror() {
        return handlers.onerror;
      },
      set onerror(h: ((e: unknown) => void) | null) {
        handlers.onerror = h;
        if (h && error) queueMicrotask(() => h({}));
      },
    };
  }

  const fakeStore = {
    get(key: string) {
      const req = makeReq(opts.failOps ? new Error('get failed') : null);
      req.result = data.get(key);
      return req;
    },
    put(value: unknown, key: string) {
      const req = makeReq(opts.failOps ? new Error('put failed') : null);
      if (!opts.failOps) data.set(key, value);
      return req;
    },
    delete(key: string) {
      const req = makeReq(opts.failOps ? new Error('delete failed') : null);
      if (!opts.failOps) data.delete(key);
      return req;
    },
  };

  const fakeDB = {
    objectStoreNames: {
      contains(name: string) {
        return storeNames.hasStore;
      },
    },
    createObjectStore() {
      storeNames.hasStore = true;
      return fakeStore;
    },
    transaction() {
      return { objectStore: () => fakeStore };
    },
  };

  return {
    open() {
      const req = makeReq(opts.failOpen ? new Error('open failed') : null, !opts.failOpen);
      if (!opts.failOpen) req.result = fakeDB;
      return req;
    },
  };
}

describe('bible storage', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    localStorage.clear();
    jest.resetModules();
  });

  describe('getKVStore without indexedDB', () => {
    it('falls back to an in-memory store and caches the instance', async () => {
      const { getKVStore } = require('./storage');
      const store = getKVStore();
      expect(store).toBe(getKVStore());
      expect(await store.get('missing')).toBeNull();
      await store.set('k', { a: 1 });
      expect(await store.get('k')).toEqual({ a: 1 });
      await store.del('k');
      expect(await store.get('k')).toBeNull();
    });
  });

  describe('getKVStore with indexedDB', () => {
    it('uses IndexedDBKV and round-trips get/set/del', async () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = makeFakeIndexedDB();
      const { getKVStore } = require('./storage');
      const store = getKVStore();
      await store.set('bible:BSB:index', { verses: ['x'], refs: [] });
      expect(await store.get('bible:BSB:index')).toEqual({ verses: ['x'], refs: [] });
      expect(await store.get('missing')).toBeNull();
      await store.del('bible:BSB:index');
      expect(await store.get('bible:BSB:index')).toBeNull();
    });

    it('rejects when opening the database fails', async () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = makeFakeIndexedDB({ failOpen: true });
      const { getKVStore } = require('./storage');
      const store = getKVStore();
      await expect(store.get('k')).rejects.toThrow('open failed');
      await expect(store.set('k', 1)).rejects.toThrow('open failed');
    });

    it('rejects when a store operation fails', async () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = makeFakeIndexedDB({ failOps: true });
      const { getKVStore } = require('./storage');
      const store = getKVStore();
      await expect(store.get('k')).rejects.toThrow('get failed');
      await expect(store.set('k', 1)).rejects.toThrow('put failed');
      await expect(store.del('k')).rejects.toThrow('delete failed');
    });
  });

  describe('setKVStore override', () => {
    it('uses the injected store instead of constructing one', async () => {
      const custom: KVStore = {
        get: jest.fn().mockResolvedValue('custom'),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
      };
      const { setKVStore, getKVStore } = require('./storage');
      setKVStore(custom);
      expect(getKVStore()).toBe(custom);
    });
  });

  describe('prefs', () => {
    it('loads saved prefs from localStorage', () => {
      const { savePrefs, loadPrefs } = require('./storage');
      savePrefs({ translation: 'ENGWEBP' });
      expect(loadPrefs()).toEqual({ translation: 'ENGWEBP' });
    });

    it('returns an empty object when nothing is stored', () => {
      const { loadPrefs } = require('./storage');
      expect(loadPrefs()).toEqual({});
    });

    it('returns an empty object when stored JSON is corrupt', () => {
      localStorage.setItem('bible-prefs', '{not-json');
      const { loadPrefs } = require('./storage');
      expect(loadPrefs()).toEqual({});
    });

    it('swallows localStorage write errors', () => {
      const { savePrefs } = require('./storage');
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      expect(() => savePrefs({ translation: 'BSB' })).not.toThrow();
    });
  });
});