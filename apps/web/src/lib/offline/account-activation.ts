import type { GraphQLUser } from '@transformlit/shared';
import { useAuthStore } from '../../store';
import { useBibleStore } from '../../store/bible-store';
import { issueAuthInstallTicket } from '../auth';
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
  const outcome = await lifecycle.establishIdentity(verification);
  if (outcome.status === 'INSTALLED') {
    bindAccountScopedState(outcome.owner.subject);
  }
  return outcome;
}

/**
 * Installs an epoch-tagged auth result (refresh / OAuth return) through the
 * gate, then installs the token/user via a lifecycle ticket. A stale epoch or
 * subject mismatch installs nothing.
 */
export async function installEpochTaggedAuth<T>(
  result: EpochTaggedResult<T>,
  install: (ticket: ReturnType<typeof issueAuthInstallTicket>) => boolean,
): Promise<InstallOutcome> {
  const outcome = await lifecycle.installIdentity(result);
  if (outcome.status === 'INSTALLED') {
    bindAccountScopedState(outcome.owner.subject);
    install(issueAuthInstallTicket(outcome.owner.subject, outcome.owner.epoch));
  }
  return outcome;
}

/**
 * Completes a local login/registration: establishes the subject, then installs
 * the token/user through the auth store's ticket-gated setter. Returns false
 * (installing nothing) when the lifecycle gate rejects the activation.
 */
export async function completeLocalAuth(user: GraphQLUser, accessToken: string): Promise<boolean> {
  const outcome = await activateIdentity({ subject: user.id, epoch: 0 });
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
