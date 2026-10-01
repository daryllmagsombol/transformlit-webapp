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
  release(name: string, ownerId: string, subject?: string): Promise<void>;
}

export interface LeaseResult {
  acquired: boolean;
  lease: LeaseRecord | null;
}

/** Per-account lease name. Two accounts never contend for the same lease. */
export function syncLeaseName(subject: string): string {
  return `sync:${subject}`;
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

  /**
   * Releases an owned lease. When `subject` is supplied it must ALSO match the
   * current lease subject: a cross-tab account switch that left this tab holding
   * a stale subject's lease can therefore never release (or tombstone) a lease
   * now owned by another subject.
   */
  async function release(name: string, ownerId: string, subject?: string): Promise<void> {
    const current = await persistence.read(name);
    const ownsLease = current?.ownerId === ownerId;
    const subjectMatches = subject === undefined || current?.subject === subject;
    if (ownsLease && subjectMatches) {
      // Keep the fencing counter monotonic: persist an expired tombstone rather
      // than deleting, so a reacquisition gets a strictly newer token and the
      // released owner's token can never be replayed as current.
      await persistence.compareAndSet(name, current.fencingToken, { ...current, expiresAt: 0 });
    }
  }

  return { acquire, renew, release };
}

/**
 * Whether a lease that was valid when an operation started is still valid after
 * the operation's network round-trip. A false result means the coordinator must
 * DISCARD the acknowledgement it just received: another tab may now own sync.
 */
export function leaseStillValid(
  lease: LeaseRecord | null,
  expectedToken: number,
  now: number,
): boolean {
  return isLeaseActive(lease, now) && lease?.fencingToken === expectedToken;
}

/**
 * Builds a sync lock over an account's lease. The subject is resolved from
 * `getSubject()` at each acquire/release so a coordinator created before
 * authentication (or surviving an account switch) always fences the CURRENT
 * owner's lease rather than the subject captured at construction. The lease
 * name active for the in-flight run is remembered so `release`/`readLease`
 * always target the same lease even if the owner changes mid-run.
 */
export function createSyncLock(
  getSubject: () => string | null,
  ownerId: string,
  options: { readonly persistence: LeasePersistence; readonly clock: Clock; readonly ttlMs: number },
): {
  acquire: () => Promise<{ acquired: boolean; ownerId: string; lease: LeaseRecord | null }>;
  release: () => Promise<void>;
  readLease: () => Promise<LeaseRecord | null>;
} {
  const coordinator = createLeaseCoordinator({ persistence: options.persistence, clock: options.clock });
  let activeName: string | null = null;
  let activeSubject: string | null = null;

  return {
    acquire: async () => {
      const subject = getSubject();
      if (!subject) return { acquired: false, ownerId, lease: null };
      activeName = syncLeaseName(subject);
      activeSubject = subject;
      const result = await coordinator.acquire(activeName, subject, ownerId, options.ttlMs);
      return { acquired: result.acquired, ownerId: result.lease?.ownerId ?? ownerId, lease: result.lease };
    },
    release: async () => {
      if (!activeName) return;
      const name = activeName;
      const subject = activeSubject;
      activeName = null;
      activeSubject = null;
      // Pass the subject the lease was acquired under so a cross-tab account
      // switch can never release a lease now owned by a different subject.
      await coordinator.release(name, ownerId, subject ?? undefined);
    },
    readLease: () => (activeName ? options.persistence.read(activeName) : Promise.resolve(null)),
  };
}
