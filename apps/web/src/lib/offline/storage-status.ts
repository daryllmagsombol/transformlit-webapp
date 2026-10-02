import { StorageUnavailableError } from './contracts';

/**
 * A snapshot of browser storage conditions. `persisted` reflects the
 * `navigator.storage.persist()` decision; `usage`/`quota` come from
 * `estimate()`. Persistent storage is best-effort and NEVER a guarantee
 * against eviction — callers must surface that honestly.
 */
export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

function storageManager(): StorageManagerLike | null {
  const navigatorRef = globalThis.navigator as (Navigator & { storage?: StorageManagerLike }) | undefined;
  return navigatorRef?.storage ?? null;
}

/** True when the browser exposes the StorageManager API at all. */
export function isStorageStatusSupported(): boolean {
  return storageManager() !== null;
}

/**
 * Requests durable (persistent) storage when available. Returns false (rather
 * than throwing) when the API is missing so callers can degrade gracefully.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const manager = storageManager();
  if (!manager?.persist) return false;
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}

/** Reads current usage/quota estimates without ever promising durability. */
export async function getStorageEstimate(): Promise<{ usage: number | null; quota: number | null }> {
  const manager = storageManager();
  if (!manager?.estimate) return { usage: null, quota: null };
  try {
    const estimate = await manager.estimate();
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

/**
 * Records the persistence outcome and reports it. When `persist` is requested
 * but the API is unavailable the status stays `supported: false`; the caller
 * must not promise immunity from eviction in that case.
 */
export async function getStorageStatus({ persist = false } = {}): Promise<StorageStatus> {
  const manager = storageManager();
  if (!manager) {
    return { supported: false, persisted: false, usage: null, quota: null };
  }

  let persisted = false;
  if (manager.persisted) {
    try {
      persisted = await manager.persisted();
    } catch {
      persisted = false;
    }
  }
  if (!persisted && persist) {
    persisted = await requestPersistentStorage();
  }

  const { usage, quota } = await getStorageEstimate();
  return { supported: true, persisted, usage, quota };
}

/** Throws a typed error when IndexedDB cannot be used in this environment. */
export function assertIndexedDbAvailable(): void {
  if (typeof globalThis.indexedDB === 'undefined') {
    throw new StorageUnavailableError();
  }
}
