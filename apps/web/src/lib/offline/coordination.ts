import { type LeaseRecord, OfflineStorageError } from './contracts';

/**
 * A monotonic source of wall-clock milliseconds. Injected so lease expiry,
 * renewal, and takeover are deterministic under test.
 */
export interface Clock {
  now(): number;
}

/**
 * The atomic primitive backing leases. Real IndexedDB provides compare-and-set
 * implicitly: a single `readwrite` transaction over the lease store reads the
 * current record and rewrites it without another writer interleaving. The
 * adapter implementation must perform read+write inside one transaction.
 */
export interface LeasePersistence {
  read(name: string): Promise<LeaseRecord | null>;
  compareAndSet(name: string, expectedToken: number | null, next: LeaseRecord | null): Promise<boolean>;
}

export interface LeaseCoordinator {
  acquire(name: string, subject: string, ownerId: string, ttlMs: number): Promise<LeaseResult>;
  renew(name: string, ownerId: string, ttlMs: number): Promise<LeaseRecord | null>;
  release(name: string, ownerId: string): Promise<void>;
}

export interface LeaseResult {
  acquired: boolean;
  lease: LeaseRecord | null;
}

export function isLeaseActive(lease: LeaseRecord | null, now: number): boolean {
  return lease !== null && lease.expiresAt > now;
}

function fenceUnavailable(message: string): never {
  throw new OfflineStorageError(message);
}

/**
 * Fails closed unless the caller holds the current, unexpired fencing token.
 * A stale token — from a tab that lost the lease or resumed after expiry — is
 * rejected so it can never publish a sync result over the new owner.
 */
export async function assertFencingToken(
  persistence: LeasePersistence,
  name: string,
  token: number,
  now: number,
): Promise<void> {
  const lease = await persistence.read(name);
  if (!isLeaseActive(lease, now) || lease?.fencingToken !== token) {
    fenceUnavailable('Lease fencing token is stale or expired');
  }
}

export function createLeaseCoordinator({
  persistence,
  clock,
}: {
  readonly persistence: LeasePersistence;
  readonly clock: Clock;
}): LeaseCoordinator {
  async function acquire(name: string, subject: string, ownerId: string, ttlMs: number): Promise<LeaseResult> {
    const current = await persistence.read(name);
    const now = clock.now();
    if (isLeaseActive(current, now) && current?.ownerId !== ownerId) {
      return { acquired: false, lease: current };
    }

    const nextToken = (current?.fencingToken ?? 0) + 1;
    const lease: LeaseRecord = {
      id: name,
      subject,
      ownerId,
      fencingToken: nextToken,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
    const expected = current?.fencingToken ?? null;
    const acquired = await persistence.compareAndSet(name, expected, lease);
    return acquired ? { acquired: true, lease } : { acquired: false, lease: await persistence.read(name) };
  }

  async function renew(name: string, ownerId: string, ttlMs: number): Promise<LeaseRecord | null> {
    const current = await persistence.read(name);
    const now = clock.now();
    if (!isLeaseActive(current, now) || current?.ownerId !== ownerId) return null;

    const renewed: LeaseRecord = { ...current, expiresAt: now + ttlMs };
    const swapped = await persistence.compareAndSet(name, current.fencingToken, renewed);
    return swapped ? renewed : null;
  }

  async function release(name: string, ownerId: string): Promise<void> {
    const current = await persistence.read(name);
    if (current?.ownerId === ownerId) {
      // Keep the fencing counter monotonic: persist an expired tombstone rather
      // than deleting, so a reacquisition gets a strictly newer token and the
      // released owner's token can never be replayed as current.
      await persistence.compareAndSet(name, current.fencingToken, { ...current, expiresAt: 0 });
    }
  }

  return { acquire, renew, release };
}
