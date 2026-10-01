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
      localOnly: 0,
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

let configured = false;

/** Wires (once) the lifecycle exit seams. Idempotent. */
export function configureAccountExit(): void {
  if (configured) return;
  configured = true;
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

/** Test seam: allow re-wiring after a singleton reset. */
export function resetAccountExitForTests(): void {
  configured = false;
}

/**
 * Begins a sign-out / account switch: freezes new writes + replay and reports
 * whether a controlled drain is required. The caller then shows the exit dialog.
 */
export async function beginAccountExit(): Promise<ExitDecision> {
  configureAccountExit();
  await accountLifecycle().hydrate();
  return accountLifecycle().beginExit('SIGN_OUT');
}

/** Completes the exit after the user syncs or explicitly confirms discard. */
export async function completeAccountExit(discard: boolean): Promise<ExitDecision> {
  configureAccountExit();
  return accountLifecycle().completeExit({ discard, reason: 'SIGN_OUT' });
}

/** Retries a deferred remote invalidation (e.g. after connectivity returns). */
export async function retryDeferredLogout(): Promise<ExitDecision> {
  configureAccountExit();
  return accountLifecycle().resolveDeferredLogout();
}

/** True when no durable barrier blocks a new activation. */
export async function accountActivationEligible(): Promise<boolean> {
  configureAccountExit();
  return accountLifecycle().activationEligible();
}
