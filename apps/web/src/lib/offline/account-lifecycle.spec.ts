import { AccountContext } from './account-context';
import {
  AccountLifecycle,
  classifyAuthError,
  classifyAuthFailure,
  type LifecyclePersistence,
} from './account-lifecycle';
import type { LifecycleBarrierRecord, LifecycleStateRecord } from './contracts';

class MemoryLifecyclePersistence implements LifecyclePersistence {
  state: LifecycleStateRecord | null = null;
  barrierRecord: LifecycleBarrierRecord | null = null;

  readState(): Promise<LifecycleStateRecord | null> {
    return Promise.resolve(this.state);
  }
  writeState(record: LifecycleStateRecord): Promise<void> {
    this.state = record;
    return Promise.resolve();
  }
  readBarrier(): Promise<LifecycleBarrierRecord | null> {
    return Promise.resolve(this.barrierRecord);
  }
  writeBarrier(record: LifecycleBarrierRecord): Promise<void> {
    this.barrierRecord = record;
    return Promise.resolve();
  }
  clearBarrier(): Promise<void> {
    this.barrierRecord = null;
    return Promise.resolve();
  }
}

function makeLifecycle() {
  const persistence = new MemoryLifecyclePersistence();
  const context = new AccountContext(persistence);
  const lifecycle = new AccountLifecycle(context, persistence);
  return { persistence, context, lifecycle };
}

describe('auth failure classification', () => {
  it('treats 401 as genuine auth failure and 5xx/network as transient', () => {
    expect(classifyAuthFailure(401)).toBe('AUTH_REQUIRED');
    expect(classifyAuthFailure(500)).toBe('TRANSIENT');
    expect(classifyAuthFailure(503)).toBe('TRANSIENT');
    expect(classifyAuthFailure(0)).toBe('TRANSIENT');
    expect(classifyAuthError(new Error('network down'))).toBe('TRANSIENT');
    expect(classifyAuthError({ statusCode: 401 })).toBe('AUTH_REQUIRED');
  });
});

describe('account lifecycle activation fencing', () => {
  it('establishes ownership only from a verified subject and permits writes', async () => {
    const { lifecycle } = makeLifecycle();
    const outcome = await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });

    expect(outcome.status).toBe('INSTALLED');
    expect(lifecycle.getOwner()).toEqual({ subject: 'user-a', epoch: 1 });
    expect(lifecycle.writePermit()).toEqual({ permitted: true, owner: { subject: 'user-a', epoch: 1 } });
  });

  it('rejects a stale-epoch install result without changing ownership', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });

    // A result tagged with the pre-establishment epoch is stale.
    const outcome = await lifecycle.installIdentity({ epoch: 0, subject: 'user-a', value: 'token' });
    expect(outcome.status).toBe('STALE_EPOCH');
    expect(lifecycle.getOwner()).toEqual({ subject: 'user-a', epoch: 1 });
  });

  it('rejects an install whose subject differs from the established owner', async () => {
    const { lifecycle } = makeLifecycle();
    const owner = await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });
    const epoch = owner.status === 'INSTALLED' ? owner.owner.epoch : 0;

    const outcome = await lifecycle.installIdentity({ epoch, subject: 'user-b', value: 'token' });
    expect(outcome.status).toBe('SUBJECT_MISMATCH');
    expect(lifecycle.getOwner()?.subject).toBe('user-a');
  });

  it('accepts a same-subject, current-epoch install', async () => {
    const { lifecycle } = makeLifecycle();
    const established = await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });
    const epoch = established.status === 'INSTALLED' ? established.owner.epoch : -1;

    const outcome = await lifecycle.installIdentity({ epoch, subject: 'user-a', value: 'token' });
    expect(outcome.status).toBe('INSTALLED');
  });

  it('fails closed on a different subject while another owner is established', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });

    const outcome = await lifecycle.establishIdentity({ subject: 'user-b', epoch: 0 });
    expect(outcome.status).toBe('BLOCKED');
    // The old owner is preserved; Task 13A must not clear/switch accounts.
    expect(lifecycle.getOwner()?.subject).toBe('user-a');
  });

  it('fails closed when a durable barrier is present', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.persistBarrier('user-a', 1, 'ACCOUNT_SWITCH');

    const outcome = await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });
    expect(outcome).toEqual({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });
    expect(lifecycle.getOwner()).toBeNull();
  });

  it('pauses replay on genuine auth failure but preserves the owner', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });
    lifecycle.markAuthRequired();

    expect(lifecycle.requireReplayIdentity()).toEqual({ status: 'PAUSED', reason: 'AUTH_REQUIRED' });
    expect(lifecycle.writePermit()).toEqual({ permitted: false, reason: 'AUTH_REQUIRED' });
    // Local ownership/content is preserved for same-subject reauthentication.
    expect(lifecycle.getOwner()).toEqual({ subject: 'user-a', epoch: 1 });
  });

  it('clears the paused state after same-subject reauthentication', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });
    lifecycle.markAuthRequired();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 1 });

    expect(lifecycle.requireReplayIdentity().status).toBe('READY');
  });

  it('keeps ownership on a transient outage without clearing a pending reauth', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });
    lifecycle.markAuthRequired();
    lifecycle.markTransient();

    // Ownership is preserved, and a genuine 401 still requires reauthentication
    // until a successful same-subject activation (a 5xx must not satisfy it).
    expect(lifecycle.getOwner()?.subject).toBe('user-a');
    expect(lifecycle.requireReplayIdentity()).toEqual({ status: 'PAUSED', reason: 'AUTH_REQUIRED' });
  });

  it('does not pause replay for a transient outage under an established owner', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });
    lifecycle.markTransient();

    expect(lifecycle.getOwner()?.subject).toBe('user-a');
    expect(lifecycle.requireReplayIdentity().status).toBe('READY');
  });

  it('has no owner and no replay identity before activation', () => {
    const { lifecycle } = makeLifecycle();
    expect(lifecycle.getOwner()).toBeNull();
    expect(lifecycle.writePermit()).toEqual({ permitted: false, reason: 'NO_OWNER' });
    expect(lifecycle.requireReplayIdentity()).toEqual({ status: 'PAUSED', reason: 'NO_OWNER' });
  });
});

describe('lifecycle exit scaffolding is fail-closed (Task 13B owns exit)', () => {
  it('refuses to exit while an owner is established', () => {
    const { lifecycle } = makeLifecycle();
    return lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 }).then(() => {
      expect(lifecycle.beginExit()).toEqual({ status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' });
    });
  });

  it('completeExit never clears data in Task 13A', async () => {
    const { lifecycle, context } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });

    const decision = await lifecycle.completeExit();
    expect(decision).toEqual({ status: 'BLOCKED', reason: 'EXIT_NOT_IMPLEMENTED' });
    // Ownership is untouched — no destructive cleanup without Task 13B.
    expect(context.getOwner()?.subject).toBe('user-a');
  });
});

describe('lifecycle barrier durability', () => {
  it('persists a barrier that survives a new lifecycle instance', async () => {
    const persistence = new MemoryLifecyclePersistence();
    const first = new AccountLifecycle(new AccountContext(persistence), persistence);
    await first.persistBarrier('user-a', 3, 'SIGN_OUT');

    // Simulate a restart: a fresh lifecycle reads the same persistence.
    const second = new AccountLifecycle(new AccountContext(persistence), persistence);
    expect(await second.barrier()).toEqual(
      expect.objectContaining({ subject: 'user-a', epoch: 3, reason: 'SIGN_OUT' }),
    );
  });
});

describe('cold-start ownership rehydration (I1)', () => {
  it('restores the established owner after a restart', async () => {
    const persistence = new MemoryLifecyclePersistence();
    const first = new AccountLifecycle(new AccountContext(persistence), persistence);
    const established = await first.establishIdentity({ subject: 'user-a', epoch: 0 });
    const epoch = established.status === 'INSTALLED' ? established.owner.epoch : -1;

    // Restart: new in-memory context, same durable persistence.
    const second = new AccountLifecycle(new AccountContext(persistence), persistence);
    expect(second.getOwner()).toBeNull();

    const restored = await second.hydrate();
    expect(restored).toEqual({ subject: 'user-a', epoch });
    expect(second.getOwner()).toEqual({ subject: 'user-a', epoch });
    expect(second.requireReplayIdentity()).toEqual({ status: 'READY', owner: { subject: 'user-a', epoch } });
  });

  it('is idempotent and does not clobber the in-memory owner', async () => {
    const { lifecycle } = makeLifecycle();
    await lifecycle.establishIdentity({ subject: 'user-a', epoch: 0 });

    const restored = await lifecycle.hydrate();
    expect(restored).toEqual({ subject: 'user-a', epoch: 1 });
    expect(lifecycle.getOwner()).toEqual({ subject: 'user-a', epoch: 1 });
  });

  it('blocks a different-subject result across a restart', async () => {
    const persistence = new MemoryLifecyclePersistence();
    const first = new AccountLifecycle(new AccountContext(persistence), persistence);
    await first.establishIdentity({ subject: 'user-a', epoch: 0 });

    // New tab/restart: owner is restored, so a different subject fails closed.
    const second = new AccountLifecycle(new AccountContext(persistence), persistence);
    await second.hydrate();

    const outcome = await second.establishIdentity({ subject: 'user-b', epoch: 0 });
    expect(outcome.status).toBe('BLOCKED');
    expect(second.getOwner()?.subject).toBe('user-a');
  });
});
