'use client';

import { useSyncExternalStore } from 'react';
import { accountLifecycle } from '../offline/account-activation';
import type { WritePermit } from '../offline/contracts';

/**
 * Reactive local-ownership permit. `accountLifecycle()` is a mutable singleton,
 * so reading `writePermit()` once per render misses an asynchronous activation
 * (the "Save offline" button would stay disabled). Subscribing via
 * `useSyncExternalStore` re-renders when ownership/auth-required state changes.
 *
 * The snapshot is memoized by lifecycle state version so React sees a stable
 * value between changes rather than a new object on every read.
 */
let cachedVersion = -1;
let cachedPermit: WritePermit = { permitted: false, reason: 'NO_OWNER' };

function getSnapshot(): WritePermit {
  const lifecycle = accountLifecycle();
  const version = lifecycle.stateVersion();
  if (version !== cachedVersion) {
    cachedVersion = version;
    cachedPermit = lifecycle.writePermit();
  }
  return cachedPermit;
}

function getServerSnapshot(): WritePermit {
  return { permitted: false, reason: 'NO_OWNER' };
}

function subscribe(listener: () => void): () => void {
  return accountLifecycle().subscribe(listener);
}

/** Reads the current write permit and re-renders on lifecycle changes. */
export function useWritePermit(): WritePermit {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam: drops the memoized snapshot between suites. */
export function resetWritePermitCacheForTests(): void {
  cachedVersion = -1;
  cachedPermit = { permitted: false, reason: 'NO_OWNER' };
}
