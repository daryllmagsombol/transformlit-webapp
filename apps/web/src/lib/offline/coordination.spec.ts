import type { LeaseRecord } from './contracts';
import {
  assertFencingToken,
  createLeaseCoordinator,
  isLeaseActive,
  type Clock,
  type LeasePersistence,
} from './coordination';

/** Deterministic clock so lease expiry/renewal tests never depend on wall time. */
class TestClock implements Clock {
  private current = 1_000;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

/**
 * In-memory stand-in for the IndexedDB-backed adapter. `compareAndSet` is the
 * atomic primitive real IndexedDB provides inside a single readwrite
 * transaction; both "tabs" here share one instance so contention is real.
 */
class MemoryLeasePersistence implements LeasePersistence {
  private readonly records = new Map<string, LeaseRecord>();
  private pending: Promise<boolean> = Promise.resolve(true);

  read(name: string): Promise<LeaseRecord | null> {
    return Promise.resolve(this.records.get(name) ?? null);
  }

  /** Serialize CAS calls to model IndexedDB's single-writer transaction lock. */
  compareAndSet(name: string, expected: number | null, next: LeaseRecord | null): Promise<boolean> {
    const run = this.pending.then(() => {
      const current = this.records.get(name) ?? null;
      const currentToken = current ? current.fencingToken : null;
      if (currentToken !== expected) return false;
      if (next) this.records.set(name, next);
      else this.records.delete(name);
      return true;
    });
    this.pending = run;
    return run;
  }
}

describe('lease coordination', () => {
  it('treats a missing or expired lease as inactive', () => {
    expect(isLeaseActive(null, 0)).toBe(false);
    expect(isLeaseActive({ id: 'l', subject: 's', ownerId: 'o', fencingToken: 1, acquiredAt: 0, expiresAt: 50 }, 60)).toBe(false);
    expect(isLeaseActive({ id: 'l', subject: 's', ownerId: 'o', fencingToken: 1, acquiredAt: 0, expiresAt: 50 }, 40)).toBe(true);
  });

  it('grants a free lease with a fresh fencing token', async () => {
    const clock = new TestClock();
    const coordinator = createLeaseCoordinator({ persistence: new MemoryLeasePersistence(), clock });
    const result = await coordinator.acquire('sync:user-a', 'user-a', 'owner-1', 1_000);
    expect(result.acquired).toBe(true);
    expect(result.lease?.fencingToken).toBe(1);
    expect(result.lease?.subject).toBe('user-a');
  });

  it('lets only one competing tab win a free lease', async () => {
    const clock = new TestClock();
    const persistence = new MemoryLeasePersistence();
    const tabA = createLeaseCoordinator({ persistence, clock });
    const tabB = createLeaseCoordinator({ persistence, clock });

    const first = await tabA.acquire('sync:user-a', 'user-a', 'tab-a', 5_000);
    const second = await tabB.acquire('sync:user-a', 'user-a', 'tab-b', 5_000);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.lease?.ownerId).toBe('tab-a');
  });

  it('hands ownership to a new tab after the previous owner dies and the lease expires', async () => {
    const clock = new TestClock();
    const persistence = new MemoryLeasePersistence();
    const deadTab = createLeaseCoordinator({ persistence, clock });
    const liveTab = createLeaseCoordinator({ persistence, clock });

    await deadTab.acquire('sync:user-a', 'user-a', 'tab-a', 1_000);
    clock.advance(5_000);

    const takeover = await liveTab.acquire('sync:user-a', 'user-a', 'tab-b', 1_000);
    expect(takeover.acquired).toBe(true);
    expect(takeover.lease?.fencingToken).toBe(2);

    await expect(assertFencingToken(persistence, 'sync:user-a', 1, clock.now())).rejects.toThrow(
      'fencing token',
    );
    await expect(assertFencingToken(persistence, 'sync:user-a', 2, clock.now())).resolves.toBeUndefined();
  });

  it('renews an owned lease without bumping the fencing token', async () => {
    const clock = new TestClock();
    const persistence = new MemoryLeasePersistence();
    const coordinator = createLeaseCoordinator({ persistence, clock });

    const acquired = await coordinator.acquire('sync:user-a', 'user-a', 'tab-a', 1_000);
    clock.advance(500);
    const renewed = await coordinator.renew('sync:user-a', 'tab-a', 1_000);

    expect(renewed?.fencingToken).toBe(acquired.lease?.fencingToken);
    expect(renewed?.expiresAt).toBe(clock.now() + 1_000);
  });

  it('refuses to renew a lease owned by another tab', async () => {
    const clock = new TestClock();
    const persistence = new MemoryLeasePersistence();
    const tabA = createLeaseCoordinator({ persistence, clock });
    await tabA.acquire('sync:user-a', 'user-a', 'tab-a', 1_000);
    expect(await tabA.renew('sync:user-a', 'tab-b', 1_000)).toBeNull();
  });

  it('releases an owned lease so the next tab can acquire it', async () => {
    const clock = new TestClock();
    const persistence = new MemoryLeasePersistence();
    const tabA = createLeaseCoordinator({ persistence, clock });
    const tabB = createLeaseCoordinator({ persistence, clock });

    await tabA.acquire('sync:user-a', 'user-a', 'tab-a', 5_000);
    await tabA.release('sync:user-a', 'tab-a');

    const next = await tabB.acquire('sync:user-a', 'user-a', 'tab-b', 5_000);
    expect(next.acquired).toBe(true);
    expect(next.lease?.fencingToken).toBe(2);
  });

  it('rejects a fencing token that does not match the current lease', async () => {
    const clock = new TestClock();
    const persistence = new MemoryLeasePersistence();
    const coordinator = createLeaseCoordinator({ persistence, clock });
    await coordinator.acquire('sync:user-a', 'user-a', 'tab-a', 5_000);
    await expect(assertFencingToken(persistence, 'sync:user-a', 99, clock.now())).rejects.toThrow();
    await expect(assertFencingToken(persistence, 'sync:user-a', 1, clock.now())).resolves.toBeUndefined();
  });
});
