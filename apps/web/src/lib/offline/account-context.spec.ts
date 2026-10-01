import {
  AccountContext,
  assertWriteEligibility,
  type LifecyclePersistence,
} from './account-context';
import { StaleEpochError, SubjectMismatchError, type LifecycleStateRecord } from './contracts';

class MemoryLifecyclePersistence implements LifecyclePersistence {
  state: LifecycleStateRecord | null = null;

  readState(): Promise<LifecycleStateRecord | null> {
    return Promise.resolve(this.state);
  }

  writeState(record: LifecycleStateRecord): Promise<void> {
    this.state = record;
    return Promise.resolve();
  }
}

describe('account context', () => {
  it('has no established owner before activation', async () => {
    const context = new AccountContext(new MemoryLifecyclePersistence());
    expect(await context.restore()).toBeNull();
    expect(context.getOwner()).toBeNull();
  });

  it('establishes an immutable subject with an incrementing lifecycle epoch', async () => {
    const context = new AccountContext(new MemoryLifecyclePersistence());
    const first = await context.establish('user-a');
    expect(first).toEqual({ subject: 'user-a', epoch: 1 });

    // Same subject keeps the same epoch; a different subject fences the old one.
    expect(await context.establish('user-a')).toEqual({ subject: 'user-a', epoch: 1 });
    expect(await context.establish('user-b')).toEqual({ subject: 'user-b', epoch: 2 });
  });

  it('fences a cleared subject with a new epoch so stale writes fail', async () => {
    const context = new AccountContext(new MemoryLifecyclePersistence());
    const owner = await context.establish('user-a');
    await context.clear();

    expect(context.getOwner()).toBeNull();
    expect(assertWriteEligibility(owner, 'user-a', owner.epoch)).toBeUndefined();

    const reestablished = await context.establish('user-a');
    expect(reestablished.epoch).toBeGreaterThan(owner.epoch);
    expect(() => assertWriteEligibility(reestablished, 'user-a', owner.epoch)).toThrow(StaleEpochError);
  });

  it('separates lifecycle ownership from display-only auth state', async () => {
    const context = new AccountContext(new MemoryLifecyclePersistence());
    await context.establish('user-a');
    context.setDisplay({ subject: 'user-a', displayName: 'Ada' });

    expect(context.getDisplay()?.displayName).toBe('Ada');

    // Clearing the owner does not let a stale display identity authorize writes.
    await context.clear();
    expect(context.getDisplay()?.displayName).toBe('Ada');
    expect(context.getOwner()).toBeNull();
    expect(() => assertWriteEligibility(context.getOwner(), 'user-a', 1)).toThrow(SubjectMismatchError);
  });

  it('rejects writes for a different subject or stale epoch', () => {
    const owner = { subject: 'user-a', epoch: 3 };
    expect(() => assertWriteEligibility(owner, 'user-b', 3)).toThrow(SubjectMismatchError);
    expect(() => assertWriteEligibility(owner, 'user-a', 2)).toThrow(StaleEpochError);
    expect(() => assertWriteEligibility(null, 'user-a', 3)).toThrow(SubjectMismatchError);
    expect(assertWriteEligibility(owner, 'user-a', 3)).toBeUndefined();
  });

  it('flags a persisted owner that a different verified subject contradicts (I-1)', async () => {
    const persistence = new MemoryLifecyclePersistence();
    persistence.state = { id: 'lifecycle', state: 'ACTIVE', subject: 'user-a', epoch: 2, updatedAt: 1 };
    const context = new AccountContext(persistence);

    // Cold restore without a verified subject adopts the persisted owner.
    await context.restore();
    expect(context.getOwner()).toEqual({ subject: 'user-a', epoch: 2 });
    expect(context.hasOwnerMismatch()).toBe(false);

    // A restore against a DIFFERENT verified subject records the mismatch so
    // replay/writes fail closed instead of reporting READY under the stale owner.
    await context.restore('user-b');
    expect(context.hasOwnerMismatch()).toBe(true);

    // A verified match clears the mismatch.
    await context.restore('user-a');
    expect(context.hasOwnerMismatch()).toBe(false);
    expect(context.getOwner()).toEqual({ subject: 'user-a', epoch: 2 });
  });
});
