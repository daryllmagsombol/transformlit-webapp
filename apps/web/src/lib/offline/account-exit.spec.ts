import {
  installAccountExit,
  resetAccountExitForTests,
  readExitWork,
  completeAccountExit,
  resumeAccountExit,
  abandonDeferredLogout,
} from './account-exit';
import { accountLifecycle, resetAccountLifecycleForTests } from './account-activation';
import { withAuthLifecycleLock, resetAuthLifecycleLockForTests } from '../auth';

jest.mock('../../store', () => ({
  useAuthStore: { getState: () => ({ clearAuth: jest.fn() }) },
}));
jest.mock('../../store/bible-store', () => ({
  useBibleStore: { getState: () => ({ setAccountSubject: jest.fn() }) },
}));
jest.mock('../apollo-client', () => ({
  resetApolloState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./sync-service', () => ({
  syncCoordinator: () => ({
    controlledDrain: jest.fn().mockResolvedValue({
      pending: 0,
      inFlightOrUncertain: 0,
      blockedSuccessors: 0,
      conflicts: 0,
      terminal: 0,
      localOnly: 0,
      fullyDrained: true,
    }),
  }),
}));

interface FakeLockManager {
  request<T>(name: string, options: { mode?: 'exclusive' | 'shared' }, callback: () => Promise<T>): Promise<T>;
}

/** A NON-reentrant Web Locks shim: a re-entrant same-lock request rejects. */
function installNonReentrantLocks(): { active: () => number } {
  let held = false;
  let active = 0;
  const manager: FakeLockManager = {
    request: async <T>(_name: string, _options: { mode?: 'exclusive' | 'shared' }, callback: () => Promise<T>) => {
      if (held) throw new Error('Deadlock: Web Locks is not reentrant');
      held = true;
      active += 1;
      try {
        return await callback();
      } finally {
        active -= 1;
        held = false;
      }
    },
  };
  (globalThis.navigator as unknown as { locks?: FakeLockManager }).locks = manager;
  return { active: () => active };
}

/**
 * A FIFO Web Locks shim that models cross-tab contention and lets a test hold a
 * lock externally (as another tab/login would).
 */
function installFifoLockManager(): {
  hold: (name: string) => () => void;
  requestCalls: string[];
  maxActive: () => number;
} {
  const chains = new Map<string, Promise<void>>();
  const requestCalls: string[] = [];
  let active = 0;
  let max = 0;
  const manager: FakeLockManager = {
    request<T>(name: string, _options: { mode?: 'exclusive' | 'shared' }, callback: () => Promise<T>) {
      requestCalls.push(name);
      const prev = chains.get(name) ?? Promise.resolve();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      chains.set(name, prev.then(() => gate));
      return prev.then(async () => {
        active += 1;
        max = Math.max(max, active);
        try {
          return await callback();
        } finally {
          active -= 1;
          release();
        }
      }) as Promise<T>;
    },
  };
  function hold(name: string): () => void {
    const prev = chains.get(name) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    chains.set(name, prev.then(() => gate));
    return release;
  }
  (globalThis.navigator as unknown as { locks?: FakeLockManager }).locks = manager;
  return { hold, requestCalls, maxActive: () => max };
}

const originalFetch = global.fetch;

describe('account exit boot wiring', () => {
  beforeEach(() => {
    resetAccountLifecycleForTests();
    resetAccountExitForTests();
    resetAuthLifecycleLockForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete (globalThis.navigator as unknown as { locks?: unknown }).locks;
    resetAuthLifecycleLockForTests();
  });

  it('installs real exit deps at boot so a cold hydrate resumes a persisted barrier', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // A barrier persisted by a previous, interrupted exit — nothing else.
    await accountLifecycle().persistBarrier('subject-a', 2, 'SIGN_OUT');
    expect(await accountLifecycle().activationEligible()).toBe(false);

    // Boot initializer (no manual configureExitDeps): installs real deps.
    installAccountExit();

    await accountLifecycle().hydrate();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await accountLifecycle().activationEligible()).toBe(true);
  });

  it('does not re-acquire the auth-lifecycle lock inside a held lock (no self-deadlock)', async () => {
    installNonReentrantLocks();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await accountLifecycle().persistBarrier('subject-a', 2, 'SIGN_OUT');
    installAccountExit();

    // Simulate the login/refresh path: hold the lifecycle lock, then hydrate
    // (which resumes the barrier and calls invalidateSession). A re-entrant lock
    // acquisition would reject here.
    await expect(
      withAuthLifecycleLock(async () => {
        await accountLifecycle().hydrate();
      }),
    ).resolves.toBeUndefined();

    expect(await accountLifecycle().activationEligible()).toBe(true);
  });

  it('keeps the deferred barrier when the server cannot confirm revocation', async () => {
    // A 200 with an explicit "no credential presented / cannot confirm" signal
    // must NOT be treated as a successful invalidation.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: false, reason: 'no-credential' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await accountLifecycle().persistBarrier('subject-a', 2, 'SIGN_OUT');
    installAccountExit();

    await accountLifecycle().hydrate();

    expect(await accountLifecycle().activationEligible()).toBe(false);
  });

  it('reports local-only work from the controlled drain', async () => {
    installAccountExit();
    const work = await readExitWork();
    expect(work.fullyDrained).toBe(true);
  });

  it('wraps completeAccountExit under a single lock acquisition', async () => {
    const locks = installNonReentrantLocks();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    installAccountExit();
    await accountLifecycle().establishIdentity({ subject: 'subject-a', epoch: 2 });

    await expect(completeAccountExit(false, true)).resolves.toEqual({ status: 'PROCEED' });
    expect(locks.active()).toBe(0);
  });

  it('serializes a barrier-resume logout behind a held lifecycle lock (not unlocked)', async () => {
    const locks = installFifoLockManager();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await accountLifecycle().persistBarrier('subject-a', 2, 'SIGN_OUT');
    installAccountExit();

    // Another agent (login/refresh in this or another tab) holds the lock.
    const release = locks.hold('transformlit-auth-lifecycle');
    let resumed = false;
    const resume = accountLifecycle().hydrate().then(() => {
      resumed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The barrier-resume logout must be blocked behind the lock, NOT run unlocked.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resumed).toBe(false);

    release();
    await resume;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(locks.requestCalls).toContain('transformlit-auth-lifecycle');
    expect(await accountLifecycle().activationEligible()).toBe(true);
  });

  it('dedupes concurrent resume+hydrate logout fetches into one request', async () => {
    installFifoLockManager();
    const fetchMock = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, json: async () => ({ revoked: true }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await accountLifecycle().persistBarrier('subject-a', 2, 'SIGN_OUT');
    installAccountExit();

    await Promise.all([resumeAccountExit(), accountLifecycle().hydrate()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('abandons an unconfirmable deferred logout on explicit request and permits re-activation', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: false, reason: 'no-credential' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await accountLifecycle().persistBarrier('subject-a', 2, 'SIGN_OUT');
    installAccountExit();
    await accountLifecycle().hydrate();
    expect(await accountLifecycle().activationEligible()).toBe(false);

    await abandonDeferredLogout();

    expect(await accountLifecycle().activationEligible()).toBe(true);
    const install = await accountLifecycle().establishIdentity({ subject: 'subject-b', epoch: 9 });
    expect(install.status).toBe('INSTALLED');
  });
});
