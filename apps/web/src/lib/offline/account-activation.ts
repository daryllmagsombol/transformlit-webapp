import type { GraphQLUser } from '@transformlit/shared';
import { useAuthStore } from '../../store';
import { useBibleStore } from '../../store/bible-store';
import { decodeJwt } from '../auth';
import { issueAuthInstallTicket, type AuthInstallTicket } from './install-ticket';
import { AccountContext } from './account-context';
import {
  AccountLifecycle,
  type AuthLifecycle,
  type EpochTaggedResult,
  type ExitDecision,
  type IdentityVerification,
  type InstallOutcome,
  type LifecyclePersistence,
  type ReplayIdentity,
  type WritePermit,
} from './account-lifecycle';
import { createIndexedDbLifecyclePersistence, createMemoryLifecyclePersistence } from './database';

/**
 * The single account lifecycle instance for the web app. Every activation path
 * (local login, registration, OAuth return bootstrap, refresh) routes through
 * this object so identity installation is epoch-fenced in one place.
 */
function createLifecycle(): AccountLifecycle {
  const persistence: LifecyclePersistence =
    typeof globalThis.indexedDB === 'undefined'
      ? createMemoryLifecyclePersistence()
      : createIndexedDbLifecyclePersistence();
  return new AccountLifecycle(new AccountContext(persistence), persistence);
}

let lifecycle = createLifecycle();

export function accountLifecycle(): AuthLifecycle {
  return lifecycle;
}

/** Test seam: rebuilds the singleton and clears any in-memory ownership. */
export function resetAccountLifecycleForTests(): void {
  lifecycle = createLifecycle();
}

/**
 * Installs the real account-exit deps exactly once, via a DYNAMIC import to
 * avoid an `account-activation` ↔ `account-exit` static import cycle. This makes
 * a cold `hydrate()` able to resume a persisted exit barrier with the real
 * invalidation/cleanup seams (not the fail-closed defaults).
 */
let exitWiring: Promise<void> | null = null;

async function ensureAccountExitWired(): Promise<void> {
  exitWiring ??= import('./account-exit')
    .then((mod) => {
      mod.installAccountExit();
    })
    .catch(() => undefined);
  await exitWiring;
}

/**
 * Test seam: clear the memoized exit-wiring import so a spec that rebuilds the
 * lifecycle singleton re-wires exit deps onto the FRESH instance.
 */
export function resetAccountExitWiringForTests(): void {
  exitWiring = null;
}

/**
 * Restores the persisted local owner after a restart. Idempotent, so it is safe
 * to call on every bootstrap; this is what makes the different-subject
 * fail-closed guard apply across restarts. It first installs the real exit deps
 * so an interrupted exit is retried rather than left blocking activation.
 *
 * `verifiedSubject` (when supplied) is the currently-verified JWT subject; a
 * persisted owner for a DIFFERENT subject is not revived, so a stale owner can
 * never authorize replay under a verified session it does not own.
 */
export async function hydrateAccountLifecycle(verifiedSubject?: string | null): Promise<void> {
  await ensureAccountExitWired();
  await lifecycle.hydrate(verifiedSubject);
}

/**
 * Binds Bible navigation preferences to the activated subject. This is the C3
 * wiring: every successful identity activation calls it so a previous
 * account's last-read position cannot surface under another account.
 */
function bindAccountScopedState(subject: string): void {
  useBibleStore.getState().setAccountSubject(subject);
}

/**
 * Establishes local ownership from a verified subject and binds account-scoped
 * UI state on success. Returns the raw outcome so callers can fail closed.
 */
export async function activateIdentity(verification: IdentityVerification): Promise<InstallOutcome> {
  await hydrateAccountLifecycle();
  const outcome = await lifecycle.establishIdentity(verification);
  if (outcome.status === 'INSTALLED') {
    bindAccountScopedState(outcome.owner.subject);
  }
  return outcome;
}

/**
 * Installs an epoch-tagged auth result (refresh / OAuth return) through the
 * gate, then installs the token/user via a lifecycle ticket. A stale epoch or
 * subject mismatch installs nothing. Account-scoped state is bound only after
 * the token/user install actually succeeds.
 */
export async function installEpochTaggedAuth<T>(
  result: EpochTaggedResult<T>,
  install: (ticket: AuthInstallTicket) => boolean,
): Promise<InstallOutcome> {
  // Reconcile the persisted owner against the VERIFIED subject before any
  // activation: a stale owner for a different subject is flagged so replay
  // cannot report READY under it, and `installIdentity` then fails closed.
  await hydrateAccountLifecycle(result.subject);
  const outcome = await lifecycle.installIdentity(result);
  if (outcome.status !== 'INSTALLED') return outcome;

  const installed = install(issueAuthInstallTicket(outcome.owner.subject, outcome.owner.epoch));
  if (!installed) {
    // The store rejected the ticket: do not claim an activated account.
    return { status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' };
  }
  bindAccountScopedState(outcome.owner.subject);
  return outcome;
}

/**
 * Completes a local login/registration. The access-token subject must match the
 * local user id (never trust the response body alone), then the subject is
 * established and the token/user installed through the ticket-gated store.
 * Returns false (installing nothing) when the gate rejects the activation.
 */
export async function completeLocalAuth(user: GraphQLUser, accessToken: string): Promise<boolean> {
  const subject = decodeJwt(accessToken)?.sub;
  if (!subject || subject !== user.id) return false;

  await hydrateAccountLifecycle();
  const epoch = await lifecycle.epoch();
  const outcome = await activateIdentity({ subject, epoch });
  if (outcome.status !== 'INSTALLED') return false;
  const ticket = issueAuthInstallTicket(outcome.owner.subject, outcome.owner.epoch);
  return useAuthStore.getState().installAuth(user, accessToken, ticket);
}

/**
 * Captures the lifecycle epoch an async auth call originates in, so its result
 * can be fenced. Reads the persisted owner when present, otherwise the durable
 * baseline epoch, so a result computed before a first activation is not
 * mistaken for a stale one.
 */
export async function captureOriginEpoch(): Promise<number> {
  return lifecycle.epoch();
}

export function requireReplayIdentity(): ReplayIdentity {
  return lifecycle.requireReplayIdentity();
}

export function writePermit(): WritePermit {
  return lifecycle.writePermit();
}

export function markAuthRequired(): void {
  lifecycle.markAuthRequired();
}

export function markTransient(): void {
  lifecycle.markTransient();
}

export function beginExit(): ExitDecision {
  return lifecycle.beginExit();
}

export function completeExit(): Promise<ExitDecision> {
  return lifecycle.completeExit();
}

export type { EpochTaggedResult, IdentityVerification, InstallOutcome };
