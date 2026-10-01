'use client';

import { API_BASE } from '../constants';
import { clearAuth } from '../auth';
import { useAuthStore } from '../../store';
import { useBibleStore } from '../../store/bible-store';
import { resetApolloState } from '../apollo-client';
import { OfflineDatabase } from './database';
import { syncCoordinator } from './sync-service';
import { accountLifecycle } from './account-activation';
import type { ExitDecision, ExitDrainReport } from './account-lifecycle';

/**
 * Task 13B wiring for the account exit flow: controlled drain, remote session
 * invalidation, destructive local cleanup, and cross-tab notification.
 *
 * This module is the only place the lifecycle's exit seams are supplied, so the
 * lifecycle core stays transport-agnostic and cycle-free.
 */

/** How long to wait for remote session invalidation before deferring logout. */
const LOGOUT_TIMEOUT_MS = 8_000;
const LIFECYCLE_CHANNEL = 'transformlit-lifecycle';

/** The outstanding work the discard explanation must name. */
export interface ExitWorkSummary {
  readonly pending: number;
  readonly inFlightOrUncertain: number;
  readonly blockedSuccessors: number;
  readonly conflicts: number;
  readonly localOnly: number;
  readonly fullyDrained: boolean;
}

export const EMPTY_EXIT_WORK: ExitWorkSummary = {
  pending: 0,
  inFlightOrUncertain: 0,
  blockedSuccessors: 0,
  conflicts: 0,
  localOnly: 0,
  fullyDrained: true,
};

/** Reads the current outstanding work via the disjoint controlled-drain contract. */
export async function readExitWork(): Promise<ExitWorkSummary> {
  try {
    const report = await syncCoordinator().controlledDrain();
    return {
      pending: report.pending,
      inFlightOrUncertain: report.inFlightOrUncertain,
      blockedSuccessors: report.blockedSuccessors,
      conflicts: report.conflicts,
      localOnly: report.localOnly,
      fullyDrained: report.fullyDrained,
    };
  } catch {
    return { ...EMPTY_EXIT_WORK, fullyDrained: false };
  }
}

/**
 * Terminates and settles the remote logout attempt within a bounded window.
 * Returns true ONLY when the server confirmed the session invalidation
 * (2xx + cleared cookie). A timeout aborts the request and returns false —
 * "timed out" is not proof the old cookie is gone, so the caller persists a
 * deferred-logout barrier rather than assuming success.
 */
async function invalidateSession(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Destructive local cleanup for the exited subject; runs after the barrier. */
async function clearLocalData(subject: string): Promise<void> {
  try {
    if (typeof globalThis.indexedDB !== 'undefined') {
      await new OfflineDatabase().clearSubject(subject);
    }
  } catch {
    // Storage cleanup is best effort under the durable barrier.
  }
  // Account-specific preferences + display state.
  useBibleStore.getState().setAccountSubject('');
  clearAuth();
  useAuthStore.getState().clearAuth();
  await resetApolloState();
}

/** Best-effort cross-tab notification. Tokens are NEVER broadcast. */
function notifyOtherTabs(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(LIFECYCLE_CHANNEL);
    channel.postMessage({ type: 'account-exit' });
    channel.close();
  } catch {
    // Cross-tab notification is advisory; the durable barrier is authoritative.
  }
}

let exitListenerInstalled = false;

/**
 * Listens for another tab's account exit and fails closed here too: it
 * re-hydrates the lifecycle so the durable barrier (if any) refuses activation
 * in this tab. Tokens are NEVER carried over the channel.
 */
export function installAccountExitListener(): void {
  if (exitListenerInstalled) return;
  if (typeof BroadcastChannel === 'undefined') return;
  exitListenerInstalled = true;
  try {
    const channel = new BroadcastChannel(LIFECYCLE_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (type !== 'account-exit') return;
      configureAccountExit();
      accountLifecycle()
        .hydrate()
        .catch(() => undefined);
    };
  } catch {
    exitListenerInstalled = false;
  }
}

/** Test seam: allow the listener to be re-installed after a reset. */
export function resetAccountExitListenerForTests(): void {
  exitListenerInstalled = false;
}

/**
 * Wires the lifecycle exit seams. Idempotent in effect (a plain reassignment of
 * module-level deps) and re-run on every entry, so a reset of the lifecycle
 * singleton never leaves stale deps behind.
 */
export function configureAccountExit(): void {
  installAccountExitListener();
  accountLifecycle().configureExitDeps({
    controlledDrain: async (): Promise<ExitDrainReport> => {
      const work = await readExitWork();
      return { ...work, terminal: 0 };
    },
    invalidateSession,
    clearLocalData,
    notifyOtherTabs,
  });
}

/** The decision plus the work the exit gate observed. */
export interface ExitRequest {
  readonly decision: ExitDecision;
  readonly work: ExitWorkSummary;
}

/**
 * Begins a sign-out / account switch and reads the outstanding work in one call
 * (collapsing the begin → drain round-trip). The caller then shows the exit
 * dialog when the work is not fully drained.
 */
export async function requestAccountExit(): Promise<ExitRequest> {
  configureAccountExit();
  await accountLifecycle().hydrate();
  const decision = accountLifecycle().beginExit('SIGN_OUT');
  if (decision.status === 'PROCEED') return { decision, work: EMPTY_EXIT_WORK };
  return { decision, work: await readExitWork() };
}

/**
 * Completes the exit after the user syncs or explicitly confirms discard. When
 * the caller already observed a fully-drained report (`drained`), the lifecycle
 * skips its own re-check (writes are frozen, so nothing new can land).
 */
export async function completeAccountExit(discard: boolean, drained = false): Promise<ExitDecision> {
  configureAccountExit();
  return accountLifecycle().completeExit({ discard, drained, reason: 'SIGN_OUT' });
}

/** Cancels a begun-but-uncommitted exit, restoring writes + replay. */
export function cancelAccountExit(): void {
  accountLifecycle().cancelExit();
}

/** Retries a deferred remote invalidation (e.g. after connectivity returns). */
export async function retryDeferredLogout(): Promise<ExitDecision> {
  configureAccountExit();
  return accountLifecycle().resolveDeferredLogout();
}

/** Resumes an interrupted exit after restart (barrier-only or deferred). */
export async function resumeAccountExit(): Promise<ExitDecision> {
  configureAccountExit();
  return accountLifecycle().resumeExit();
}

/** True when no durable barrier blocks a new activation. */
export async function accountActivationEligible(): Promise<boolean> {
  configureAccountExit();
  return accountLifecycle().activationEligible();
}
