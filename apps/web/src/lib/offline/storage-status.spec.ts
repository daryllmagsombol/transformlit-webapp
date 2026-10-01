import {
  getStorageEstimate,
  getStorageStatus,
  isStorageStatusSupported,
  requestPersistentStorage,
} from './storage-status';

type NavigatorWithStorage = Navigator & { storage?: unknown };

function setStorage(storage: unknown): void {
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    writable: true,
    value: storage,
  });
}

describe('storage status', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis.navigator as NavigatorWithStorage, 'storage');
  });

  it('reports unsupported when the StorageManager API is absent', async () => {
    expect(isStorageStatusSupported()).toBe(false);
    expect(await getStorageStatus()).toEqual({ supported: false, persisted: false, usage: null, quota: null });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('requests persistent storage and reports the outcome', async () => {
    const persist = jest.fn().mockResolvedValue(true);
    setStorage({
      persisted: jest.fn().mockResolvedValue(false),
      persist,
      estimate: jest.fn().mockResolvedValue({ usage: 100, quota: 1000 }),
    });

    const status = await getStorageStatus({ persist: true });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(status).toEqual({ supported: true, persisted: true, usage: 100, quota: 1000 });
  });

  it('does not claim persisted when the browser denies persistence', async () => {
    setStorage({
      persisted: jest.fn().mockResolvedValue(false),
      persist: jest.fn().mockResolvedValue(false),
      estimate: jest.fn().mockResolvedValue({}),
    });
    const status = await getStorageStatus({ persist: true });
    expect(status.persisted).toBe(false);
    expect(status.usage).toBeNull();
    expect(status.quota).toBeNull();
  });

  it('degrades to null estimates when the API throws', async () => {
    setStorage({
      estimate: jest.fn().mockRejectedValue(new Error('nope')),
    });
    expect(await getStorageEstimate()).toEqual({ usage: null, quota: null });
  });

  it('swallows persist() failures rather than rejecting', async () => {
    setStorage({ persist: jest.fn().mockRejectedValue(new Error('denied')) });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
