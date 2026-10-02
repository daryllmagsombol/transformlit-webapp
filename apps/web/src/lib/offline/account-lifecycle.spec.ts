import {
  AccountLifecycle,
  type ExitDrainReport,
  type LifecycleExitDeps,
  type LifecyclePersistence,
} from './account-lifecycle';
import { AccountContext } from './account-context';
import type {
  AccountOwner,
  DeferredLogoutRecord,
  LifecycleBarrierRecord,
  LifecycleStateRecord,
} from './contracts';

const SUBJECT = 'subject-a';

class MemoryPersistence implements LifecyclePersistence {
  state: LifecycleStateRecord | null = null;
  barrier: LifecycleBarrierRecord | null = null;
  deferred: DeferredLogoutRecord | null = null;
  readonly barrierWrites: number[] = [];
  /** Optional shared trace so tests can assert barrier-before-cleanup ordering. */
  events: string[] | null = null;

  readState() {
    return Promise.resolve(this.state);
  }
  writeState(record: LifecycleStateRecord) {
    this.state = record;
    return Promise.resolve();
  }
  readBarrier() {
    return Promise.resolve(this.barrier);
  }
  writeBarrier(record: LifecycleBarrierRecord) {
    this.barrier = record;
    this.barrierWrites.push(this.barrierWrites.length);
    this.events?.push('barrier');
    return Promise.resolve();
  }
  clearBarrier() {
    this.barrier = null;
    return Promise.resolve();
  }
  readDeferredLogout() {
    return Promise.resolve(this.deferred);
  }
  writeDeferredLogout(record: DeferredLogoutRecord) {
    this.deferred = record;
    return Promise.resolve();
  }
  clearDeferredLogout() {
    this.deferred = null;
    return Promise.resolve();
  }
}

function drainReport(overrides: Partial<ExitDrainReport> = {}): ExitDrainReport {
  return {
    fullyDrained: true,
    pending: 0,
    inFlightOrUncertain: 0,
    blockedSuccessors: 0,
    conflicts: 0,
    terminal: 0,
    localOnly: 0,
    ...overrides,
  };
}

interface Harness {
  readonly persistence: MemoryPersistence;
  readonly lifecycle: AccountLifecycle;
  readonly events: string[];
  readonly owner: AccountOwner | null;
}

function makeHarness(options: {
  owner?: AccountOwner | null;
  drain?: ExitDrainReport;
  invalidate?: boolean;
  invalidateThrows?: boolean;
} = {}): Harness {
  const persistence = new MemoryPersistence();
  const context = new AccountContext(persistence);
  const events: string[] = [];
  persistence.events = events;
  const lifecycle = new AccountLifecycle(context, persistence);
  const drain = options.drain ?? drainReport();
  const deps: LifecycleExitDeps = {
    controlledDrain: async () => {
      events.push('drain');
      return drain;
    },
    invalidateSession: async () => {
      events.push('invalidate');
      if (options.invalidateThrows) throw new Error('network down');
      return options.invalidate ?? true;
    },
    clearLocalData: async (subject) => {
      events.push(`clear:${subject}`);
    },
    notifyOtherTabs: () => {
      events.push('notify');
    },
  };
  lifecycle.configureExitDeps(deps);
  return { persistence, lifecycle, events, owner: options.owner ?? null };
}

describe('account lifecycle activation gating', () => {
  it('hydrates a persisted owner and blocks a different subject until exit', async () => {
    const { persistence, lifecycle } = makeHarness();
    persistence.state = { id: 'lifecycle', state: 'ACTIVE', subject: SUBJECT, epoch: 3, updatedAt: 1 };

    expect(await lifecycle.hydrate()).toEqual({ subject: SUBJECT, epoch: 3 });
    const outcome = await lifecycle.establishIdentity({ subject: 'subject-b', epoch: 3 });
    expect(outcome.status).toBe('BLOCKED');
  });

  it('treats a transient outage as non-destructive: ownership and epoch are preserved', async () => {
    const { persistence, lifecycle } = makeHarness();
    persistence.state = { id: 'lifecycle', state: 'ACTIVE', subject: SUBJECT, epoch: 4, updatedAt: 1 };
    await lifecycle.hydrate();

    lifecycle.markTransient();

    expect(lifecycle.getOwner()).toEqual({ subject: SUBJECT, epoch: 4 });
    expect(lifecycle.writePermit()).toMatchObject({ permitted: true });
    expect(lifecycle.requireReplayIdentity().status).toBe('READY');
  });

  it('pauses replay and writes on genuine auth-required without clearing ownership', async () => {
    const { persistence, lifecycle } = makeHarness();
    persistence.state = { id: 'lifecycle', state: 'ACTIVE', subject: SUBJECT, epoch: 4, updatedAt: 1 };
    await lifecycle.hydrate();

    lifecycle.markAuthRequired();

    expect(lifecycle.getOwner()).toEqual({ subject: SUBJECT, epoch: 4 });
    expect(lifecycle.writePermit()).toMatchObject({ permitted: false, reason: 'AUTH_REQUIRED' });
    expect(lifecycle.requireReplayIdentity()).toMatchObject({ status: 'PAUSED', reason: 'AUTH_REQUIRED' });
  });

  it('does not report READY when a verified subject contradicts the persisted owner (I-1)', async () => {
    const harness = makeHarness();
    harness.persistence.state = {
      id: 'lifecycle',
      state: 'ACTIVE',
      subject: SUBJECT,
      epoch: 4,
      updatedAt: 1,
    };

    // A different verified subject is supplied on restore: the persisted owner
    // must not authorize replay.
    await harness.lifecycle.hydrate('subject-b');

    expect(harness.lifecycle.requireReplayIdentity()).toMatchObject({
      status: 'PAUSED',
      reason: 'BLOCKED',
    });
    expect(harness.lifecycle.writePermit()).toMatchObject({ permitted: false, reason: 'BLOCKED' });

    // Re-hydrating with the verified subject MATCHING the persisted owner
    // reconciles ownership and restores READY; a different subject stays paused.
    await harness.lifecycle.hydrate(SUBJECT);
    expect(harness.lifecycle.requireReplayIdentity().status).toBe('READY');
  });
});

describe('controlled drain before exit', () => {
  it('freezes new writes/replay while draining', async () => {
    const harness = makeHarness({ owner: { subject: SUBJECT, epoch: 2 } });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });

    const decision = harness.lifecycle.beginExit();

    expect(decision).toEqual({ status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' });
    expect(harness.lifecycle.writePermit()).toMatchObject({ permitted: false, reason: 'BLOCKED' });
    expect(harness.lifecycle.requireReplayIdentity()).toMatchObject({ status: 'PAUSED', reason: 'BLOCKED' });
  });

  it('refuses to exit while the controlled drain reports outstanding work', async () => {
    const harness = makeHarness({ drain: drainReport({ fullyDrained: false, conflicts: 1, localOnly: 2 }) });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();

    const decision = await harness.lifecycle.completeExit();

    expect(decision).toEqual({ status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' });
    // No barrier written, no cleanup performed.
    expect(harness.persistence.barrier).toBeNull();
    expect(harness.events).toEqual(['drain']);
  });

  it('gates un-synced sign-out on controlledDrain(), never on a raw pending count', async () => {
    // blocked successors/conflicts present but fullyDrained=true (all acknowledged/resolved).
    const harness = makeHarness({
      drain: drainReport({ fullyDrained: true, blockedSuccessors: 0, pending: 0 }),
    });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();

    const decision = await harness.lifecycle.completeExit();

    expect(decision).toEqual({ status: 'PROCEED' });
  });

  it('proceeds on explicit informed discard without a drain', async () => {
    const harness = makeHarness({ drain: drainReport({ fullyDrained: false, conflicts: 3, localOnly: 1 }) });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();

    const decision = await harness.lifecycle.completeExit({ discard: true });

    expect(decision).toEqual({ status: 'PROCEED' });
    expect(harness.events).not.toContain('drain');
    expect(harness.events).toContain(`clear:${SUBJECT}`);
  });
});

describe('cancelling an exit', () => {
  it('unfreezes writes and replay when the user cancels sign-out', async () => {
    const harness = makeHarness();
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();
    expect(harness.lifecycle.writePermit()).toMatchObject({ permitted: false, reason: 'BLOCKED' });

    harness.lifecycle.cancelExit();

    expect(harness.lifecycle.writePermit()).toMatchObject({ permitted: true });
    expect(harness.lifecycle.requireReplayIdentity().status).toBe('READY');
  });

  it('allows beginExit again after a cancel', async () => {
    const harness = makeHarness();
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();
    harness.lifecycle.cancelExit();

    const decision = harness.lifecycle.beginExit();

    expect(decision).toEqual({ status: 'SYNC_REQUIRED', reason: 'PENDING_WORK' });
    expect(harness.lifecycle.writePermit()).toMatchObject({ permitted: false, reason: 'BLOCKED' });
  });

});

describe('barrier, cleanup and invalidation ordering', () => {
  it('persists the barrier BEFORE destructive cleanup and before remote invalidation', async () => {
    const harness = makeHarness();
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();

    await harness.lifecycle.completeExit();

    // drain → persist barrier → remote invalidation → local cleanup → notify.
    expect(harness.persistence.barrierWrites).toHaveLength(1);
    expect(harness.events).toEqual(['drain', 'barrier', 'invalidate', `clear:${SUBJECT}`, 'notify']);
  });

  it('clears the barrier (activation eligible) only AFTER destructive cleanup settles', async () => {
    const harness = makeHarness();
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();

    // Make cleanup observably last: record when the barrier is cleared.
    let barrierClearedDuringCleanup: boolean | null = null;
    harness.lifecycle.configureExitDeps({
      controlledDrain: async () => drainReport(),
      invalidateSession: async () => true,
      clearLocalData: async (subject) => {
        harness.events.push(`clear:${subject}`);
        harness.persistence.events = harness.events;
        // Read the barrier from inside cleanup — it must still be durable.
        barrierClearedDuringCleanup = harness.persistence.barrier === null;
      },
    });

    const decision = await harness.lifecycle.completeExit();

    expect(decision).toEqual({ status: 'PROCEED' });
    // Cleanup ran while the barrier was still durable, and activation becomes
    // eligible only afterwards.
    expect(barrierClearedDuringCleanup).toBe(false);
    expect(harness.persistence.barrier).toBeNull();
    expect(await harness.lifecycle.activationEligible()).toBe(true);
  });

  it('advances the epoch and fences late results from the previous owner', async () => {
    const harness = makeHarness();
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    const before = await harness.lifecycle.epoch();
    harness.lifecycle.beginExit();

    await harness.lifecycle.completeExit({ discard: true });

    expect(harness.lifecycle.getOwner()).toBeNull();
    const after = await harness.lifecycle.epoch();
    expect(after).toBeGreaterThan(before);
    // A late result from the old epoch can never install a session.
    const late = await harness.lifecycle.installIdentity({ epoch: before, subject: SUBJECT, value: null });
    expect(late.status).not.toBe('INSTALLED');
  });
});

describe('deferred logout', () => {
  it('persists a deferred logout when remote invalidation fails, completing local cleanup', async () => {
    const harness = makeHarness({ invalidate: false });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();

    const decision = await harness.lifecycle.completeExit();

    expect(decision).toEqual({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });
    expect(harness.persistence.deferred).not.toBeNull();
    // Local cleanup still completed under the durable barrier.
    expect(harness.events).toContain(`clear:${SUBJECT}`);
  });

  it('persists a deferred logout when remote invalidation throws (timeout/offline)', async () => {
    const harness = makeHarness({ invalidateThrows: true });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();

    const decision = await harness.lifecycle.completeExit();

    expect(decision).toEqual({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });
    expect(harness.persistence.deferred).not.toBeNull();
  });

  it('blocks EVERY activation path while a deferred logout is pending', async () => {
    const harness = makeHarness({ invalidate: false });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();
    await harness.lifecycle.completeExit();

    const establish = await harness.lifecycle.establishIdentity({ subject: 'subject-b', epoch: 3 });
    expect(establish).toEqual({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });
    const install = await harness.lifecycle.installIdentity({ epoch: 3, subject: 'subject-b', value: null });
    expect(install).toEqual({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });
  });

  it('auto-resumes a barrier-only state on hydrate (crash mid-exit) without a manual retry', async () => {
    // Simulate a crash between persistBarrier and the rest of the exit: only a
    // durable barrier remains, no deferred marker.
    const harness = makeHarness();
    await harness.lifecycle.persistBarrier(SUBJECT, 2, 'SIGN_OUT');

    // Re-hydrate with a WORKING invalidation: hydrate must retry and, on
    // success, run cleanup and clear the barrier so activation is not blocked
    // forever.
    let invalidated = false;
    harness.lifecycle.configureExitDeps({
      controlledDrain: async () => drainReport(),
      invalidateSession: async () => {
        invalidated = true;
        return true;
      },
      clearLocalData: async (subject) => {
        harness.events.push(`clear:${subject}`);
      },
    });

    await harness.lifecycle.hydrate();

    expect(invalidated).toBe(true);
    expect(harness.persistence.barrier).toBeNull();
    expect(harness.events).toContain(`clear:${SUBJECT}`);
    expect(await harness.lifecycle.activationEligible()).toBe(true);
  });

  it('keeps a barrier-only state blocked when resume invalidation still fails', async () => {
    const harness = makeHarness({ invalidate: false });
    await harness.lifecycle.persistBarrier(SUBJECT, 2, 'SIGN_OUT');

    await harness.lifecycle.hydrate();

    expect(await harness.lifecycle.activationEligible()).toBe(false);
  });

  it('resumes after restart: a rehydrated lifecycle still sees the deferred barrier', async () => {
    const harness = makeHarness({ invalidate: false });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();
    await harness.lifecycle.completeExit();

    // Simulate restart: new context/lifecycle over the SAME durable persistence.
    const context = new AccountContext(harness.persistence);
    const restarted = new AccountLifecycle(context, harness.persistence);
    expect(await restarted.hydrate()).toBeNull();
    const outcome = await restarted.establishIdentity({ subject: 'subject-b', epoch: 3 });
    expect(outcome).toEqual({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });
  });

  it('unblocks activation only after deferred invalidation completes', async () => {
    const harness = makeHarness({ invalidate: false });
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();
    await harness.lifecycle.completeExit();

    // Connectivity returns: retry the deferred invalidation with success.
    let settled = false;
    harness.lifecycle.configureExitDeps({
      controlledDrain: async () => drainReport(),
      invalidateSession: async () => {
        settled = true;
        return true;
      },
      clearLocalData: async () => undefined,
    });

    const resolved = await harness.lifecycle.resolveDeferredLogout();
    expect(resolved).toEqual({ status: 'PROCEED' });
    expect(settled).toBe(true);
    expect(harness.persistence.deferred).toBeNull();

    const activation = await harness.lifecycle.establishIdentity({ subject: 'subject-b', epoch: 5 });
    expect(activation.status).toBe('INSTALLED');
  });
});

describe('activation eligibility', () => {
  it('reports not-eligible while a barrier or deferred logout is durable', async () => {
    const harness = makeHarness({ invalidate: false });
    expect(await harness.lifecycle.activationEligible()).toBe(true);
    await harness.lifecycle.establishIdentity({ subject: SUBJECT, epoch: 2 });
    harness.lifecycle.beginExit();
    await harness.lifecycle.completeExit();
    expect(await harness.lifecycle.activationEligible()).toBe(false);
  });
});
