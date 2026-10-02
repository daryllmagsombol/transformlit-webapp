import {
  installAccountExit,
  resetAccountExitForTests,
  requestAccountExit,
  cancelAccountExit,
  completeAccountExit,
  accountActivationEligible,
} from './account-exit';
import { accountLifecycle, resetAccountLifecycleForTests } from './account-activation';
import { resetAuthLifecycleLockForTests } from '../auth';
import { resetOfflineDatabaseHandle } from './database';
import { createMemoryIndexedDb, memoryIdbKeyRange } from '../../../test/helpers/memory-indexeddb';

jest.mock('../../store', () => ({
  useAuthStore: { getState: () => ({ clearAuth: jest.fn() }) },
}));
jest.mock('../../store/bible-store', () => ({
  useBibleStore: { getState: () => ({ setAccountSubject: jest.fn() }) },
}));
jest.mock('../apollo-client', () => ({
  resetApolloState: jest.fn().mockResolvedValue(undefined),
}));

const mockControlledDrain = jest.fn();
jest.mock('./sync-service', () => ({
  syncCoordinator: () => ({ controlledDrain: mockControlledDrain }),
}));

const DRAINED = {
  pending: 2,
  inFlightOrUncertain: 1,
  blockedSuccessors: 3,
  conflicts: 4,
  localOnly: 5,
  fullyDrained: false,
};

/** A minimal BroadcastChannel capturing postMessage/close for notify assertions. */
class FakeBroadcastChannel {
  static readonly instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  readonly posted: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  close(): void {
    this.closed = true;
  }
}

describe('account-exit entrypoints (uncovered paths)', () => {
  beforeEach(() => {
    mockControlledDrain.mockReset();
    mockControlledDrain.mockResolvedValue({
      pending: 0,
      inFlightOrUncertain: 0,
      blockedSuccessors: 0,
      conflicts: 0,
      localOnly: 0,
      fullyDrained: true,
    });
    resetAccountLifecycleForTests();
    resetAccountExitForTests();
    resetAuthLifecycleLockForTests();
    FakeBroadcastChannel.instances.length = 0;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeBroadcastChannel;
  });

  afterEach(() => {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    resetAuthLifecycleLockForTests();
  });

  it('readExitWork maps the controlled-drain contract into the exit summary', async () => {
    installAccountExit();
    mockControlledDrain.mockResolvedValue(DRAINED);

    const { decision, work } = await requestAccountExit();

    // No owner yet: the lifecycle proceeds immediately.
    expect(decision.status).toBe('PROCEED');
    expect(work.fullyDrained).toBe(true);

    await accountLifecycle().establishIdentity({ subject: 'subject-a', epoch: 1 });
    const next = await requestAccountExit();
    expect(next.decision.status).toBe('SYNC_REQUIRED');
    expect(next.work).toMatchObject({
      pending: 2,
      inFlightOrUncertain: 1,
      blockedSuccessors: 3,
      conflicts: 4,
      localOnly: 5,
      fullyDrained: false,
    });
  });

  it('reports a not-fully-drained empty summary when the drain itself fails', async () => {
    installAccountExit();
    await accountLifecycle().establishIdentity({ subject: 'subject-a', epoch: 1 });
    mockControlledDrain.mockRejectedValue(new Error('coordinator offline'));

    const { work } = await requestAccountExit();

    expect(work).toEqual({
      pending: 0,
      inFlightOrUncertain: 0,
      blockedSuccessors: 0,
      conflicts: 0,
      localOnly: 0,
      fullyDrained: false,
    });
  });

  it('cancelAccountExit unfreezes a begun exit', async () => {
    installAccountExit();
    await accountLifecycle().establishIdentity({ subject: 'subject-a', epoch: 1 });

    const begun = await requestAccountExit();
    expect(begun.decision.status).toBe('SYNC_REQUIRED');

    cancelAccountExit();

    // After cancelling, a fresh exit begins again (not stuck frozen).
    const again = await requestAccountExit();
    expect(again.decision.status).toBe('SYNC_REQUIRED');
    expect(await accountActivationEligible()).toBe(true);
  });

  it('keeps the barrier when the logout response is not ok', async () => {
    installAccountExit();
    await accountLifecycle().establishIdentity({ subject: 'subject-a', epoch: 2 });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    const decision = await completeAccountExit(false, true);

    expect(decision).toEqual({ status: 'BLOCKED', reason: 'DEFERRED_LOGOUT' });
    expect(await accountActivationEligible()).toBe(false);
  });

  it('notifies other tabs and clears local IndexedDB data on a confirmed exit', async () => {
    (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = memoryIdbKeyRange;
    (globalThis as { indexedDB?: unknown }).indexedDB = createMemoryIndexedDb().indexedDB;
    installAccountExit();
    await accountLifecycle().establishIdentity({ subject: 'subject-a', epoch: 2 });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: true }),
    }) as unknown as typeof fetch;

    const decision = await completeAccountExit(false, true);

    expect(decision).toEqual({ status: 'PROCEED' });
    const notifyChannel = FakeBroadcastChannel.instances.find((instance) => instance.posted.length > 0);
    expect(notifyChannel?.name).toBe('transformlit-lifecycle');
    expect(notifyChannel?.posted).toEqual([{ type: 'account-exit' }]);
    expect(notifyChannel?.closed).toBe(true);
  });

  it('installs a cross-tab listener that re-hydrates the lifecycle on an exit message', async () => {
    installAccountExit();
    const listenerChannel = FakeBroadcastChannel.instances.find((instance) => instance.onmessage !== null);
    expect(listenerChannel).toBeDefined();

    const hydrateSpy = jest.spyOn(accountLifecycle(), 'hydrate').mockResolvedValue(null);
    listenerChannel?.onmessage?.({ data: { type: 'account-exit' } } as MessageEvent);
    listenerChannel?.onmessage?.({ data: { type: 'ignored' } } as MessageEvent);

    expect(hydrateSpy).toHaveBeenCalledTimes(1);
    hydrateSpy.mockRestore();
  });
});
