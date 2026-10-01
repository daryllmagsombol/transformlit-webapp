'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { UpdatePrompt } from './update-prompt';
import { syncCoordinator } from '../../lib/offline/sync-service';

/**
 * A barrier that must resolve before a waiting worker is allowed to activate.
 * Task 4/11 register barriers so activation waits for local writes/outbox flushing.
 */
export type UpdateBarrier = () => Promise<void> | void;

const updateBarriers = new Set<UpdateBarrier>();

/**
 * Registers an activation barrier and returns an unregister function. With no
 * barriers registered, activation proceeds as soon as the user consents.
 */
export function registerUpdateBarrier(waiter: UpdateBarrier): () => void {
  updateBarriers.add(waiter);
  return () => {
    updateBarriers.delete(waiter);
  };
}

async function awaitRegisteredBarriers(): Promise<void> {
  const pending = [...updateBarriers].map((waiter) => Promise.resolve(waiter()));
  await Promise.all(pending);
}

export interface PwaUpdateValue {
  readonly updateAvailable: boolean;
  readonly applyUpdate: () => Promise<void>;
  readonly dismissUpdate: () => void;
}

const PwaUpdateContext = createContext<PwaUpdateValue | null>(null);

export function usePwaUpdate(): PwaUpdateValue {
  const value = useContext(PwaUpdateContext);
  if (!value) throw new Error('usePwaUpdate must be used within a PwaProvider');
  return value;
}

function reportRegistrationError(error: unknown): void {
  // Registration failure is non-fatal; the online app stays fully usable.
  console.debug('PWA worker registration failed', error);
}

function reportUpdateError(error: unknown): void {
  // The waiting worker may have been replaced before consent was applied.
  console.debug('PWA update message failed', error);
}

function reloadApplication(): void {
  globalThis.window.location.reload();
}

/**
 * Foreground sync triggers for the Task 11 coordinator: launch, reconnect, and
 * focus. It is best-effort — failures are surfaced by the sync-status UI, not
 * thrown. This intentionally does NOT rely on Background Sync for correctness.
 *
 * It also registers a Task 3 update barrier so a waiting service worker only
 * activates after a controlled drain reports no outstanding work.
 */
function useForegroundSync(registerBarrier: boolean, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const browser = globalThis.window;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      syncCoordinator().drain().catch(() => {
        /* the sync-status surface reports failures */
      });
    };

    // Launch: refresh authoritative snapshots, then replay queued work.
    syncCoordinator().refreshSnapshots().catch(() => undefined);
    run();

    const onFocus = () => run();
    const onOnline = () => run();
    // A reconnect is NOT proven by `navigator.onLine`; these events are only
    // hints to attempt a drain. The coordinator verifies reachability itself.
    browser.addEventListener('focus', onFocus);
    browser.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      browser.removeEventListener('focus', onFocus);
      browser.removeEventListener('online', onOnline);
    };
  }, [enabled]);

  useEffect(() => {
    if (!registerBarrier || !enabled) return;
    return registerUpdateBarrier(async () => {
      // Inspect outstanding work before activation. The barrier completing just
      // means the attempt ran; Task 13B owns blocking activation when the drain
      // is not fully complete. Work is never silently treated as drained.
      await syncCoordinator().controlledDrain();
    });
  }, [registerBarrier, enabled]);
}

interface PwaProviderProps {
  readonly children: ReactNode;
  /** Reload entry point, overridable in tests to avoid jsdom navigation. */
  readonly reload?: () => void;
  /** Disable foreground sync (tests that do not exercise the coordinator). */
  readonly enableSync?: boolean;
}

export function PwaProvider({ children, reload = reloadApplication, enableSync = true }: PwaProviderProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const consentedRef = useRef(false);
  const reloadedRef = useRef(false);

  useForegroundSync(true, enableSync);

  useEffect(() => {
    const browser = globalThis.window;
    const container = browser.navigator.serviceWorker;
    if (!container) return;

    let cancelled = false;

    const advertiseWaiting = (worker: ServiceWorker | null) => {
      if (cancelled || !worker) return;
      waitingWorkerRef.current = worker;
      setUpdateAvailable(true);
    };

    const trackInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && container.controller) {
          advertiseWaiting(worker);
        }
      });
    };

    const handleControllerChange = () => {
      if (!consentedRef.current || reloadedRef.current) return;
      reloadedRef.current = true;
      reload();
    };

    container.addEventListener('controllerchange', handleControllerChange);

    const handleRegistration = (registration: ServiceWorkerRegistration) => {
      if (cancelled) return;
      if (registration.waiting) advertiseWaiting(registration.waiting);
      registration.addEventListener('updatefound', () => trackInstalling(registration.installing));
    };

    container
      .register('/sw.js', { scope: '/' })
      .then(handleRegistration)
      .catch(reportRegistrationError);

    return () => {
      cancelled = true;
      container.removeEventListener('controllerchange', handleControllerChange);
    };
  }, [reload]);

  const applyUpdate = useCallback(async () => {
    await awaitRegisteredBarriers();
    const worker = waitingWorkerRef.current;
    if (!worker) return;
    consentedRef.current = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
    setUpdateAvailable(false);
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  const handleUpdate = useCallback(() => {
    applyUpdate().catch(reportUpdateError);
  }, [applyUpdate]);

  const value = useMemo<PwaUpdateValue>(
    () => ({ updateAvailable, applyUpdate, dismissUpdate }),
    [updateAvailable, applyUpdate, dismissUpdate],
  );

  return (
    <PwaUpdateContext.Provider value={value}>
      {children}
      <UpdatePrompt open={updateAvailable} onUpdate={handleUpdate} onLater={dismissUpdate} />
    </PwaUpdateContext.Provider>
  );
}
