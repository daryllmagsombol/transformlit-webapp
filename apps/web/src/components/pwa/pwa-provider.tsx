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
import {
  installAccountExit,
  resumeAccountExit,
} from '../../lib/offline/account-exit';

/**
 * A barrier that must permit activation before a waiting worker is told to
 * activate. Task 4/11 register barriers so activation waits for local writes /
 * outbox flushing. Returning `false`, or throwing, VETOES activation for this
 * attempt: the waiting worker is not asked to activate and the update stays
 * pending so the user can retry once outstanding work settles.
 */
export type UpdateBarrier = () => boolean | void | Promise<boolean | void>;

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

/**
 * Runs every registered barrier and reports whether they ALL permitted
 * activation. A barrier that returns `false` or rejects vetoes the attempt; the
 * remaining barriers still run so a single failure does not mask the others.
 */
async function awaitRegisteredBarriers(): Promise<boolean> {
  const outcomes = await Promise.all(
    [...updateBarriers].map(async (barrier) => {
      try {
        return (await barrier()) !== false;
      } catch (error) {
        console.debug('Update barrier vetoed activation', error);
        return false;
      }
    }),
  );
  return outcomes.every((permitted) => permitted);
}

export interface PwaUpdateValue {
  readonly updateAvailable: boolean;
  /**
   * True when the most recent "Update now" attempt was vetoed by a barrier
   * because local work was outstanding. The waiting worker stays pending and
   * the prompt remains visible so the user can retry once work settles.
   */
  readonly updateDeferred: boolean;
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
  // Boot: install the REAL account-exit deps + cross-tab listener exactly once
  // so a cold start can resume a persisted exit barrier (the lifecycle cannot
  // import the exit module without a cycle).
  useEffect(() => {
    installAccountExit();
    resumeAccountExit().catch(() => undefined);
  }, []);

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
      // Inspect outstanding work before activation and REFUSE activation unless
      // the controlled drain is fully complete. Pending/in-flight/conflict work
      // keeps the waiting worker pending rather than being silently discarded.
      const report = await syncCoordinator().controlledDrain();
      return report.fullyDrained;
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
  const [updateDeferred, setUpdateDeferred] = useState(false);
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
    const permitted = await awaitRegisteredBarriers();
    if (!permitted) {
      // A barrier vetoed activation (outstanding local work). Keep the worker
      // waiting and the prompt visible so the user can retry.
      setUpdateDeferred(true);
      return;
    }
    const worker = waitingWorkerRef.current;
    if (!worker) return;
    consentedRef.current = true;
    setUpdateDeferred(false);
    worker.postMessage({ type: 'SKIP_WAITING' });
    setUpdateAvailable(false);
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateDeferred(false);
    setUpdateAvailable(false);
  }, []);

  const handleUpdate = useCallback(() => {
    applyUpdate().catch(reportUpdateError);
  }, [applyUpdate]);

  const value = useMemo<PwaUpdateValue>(
    () => ({ updateAvailable, updateDeferred, applyUpdate, dismissUpdate }),
    [updateAvailable, updateDeferred, applyUpdate, dismissUpdate],
  );

  return (
    <PwaUpdateContext.Provider value={value}>
      {children}
      {updateDeferred ? (
        <p
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 mx-auto mb-[max(1rem,env(safe-area-inset-bottom))] max-w-md rounded-full border border-outline-variant bg-surface-container-high px-4 py-2 text-center font-small text-sm text-on-surface shadow-[0_18px_50px_-24px_rgba(56,38,19,0.55)]"
        >
          Finishing your saved work before updating. Try again once it’s done.
        </p>
      ) : null}
      <UpdatePrompt open={updateAvailable} onUpdate={handleUpdate} onLater={dismissUpdate} />
    </PwaUpdateContext.Provider>
  );
}
