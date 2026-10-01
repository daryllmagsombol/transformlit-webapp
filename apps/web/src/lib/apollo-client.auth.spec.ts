jest.mock('graphql-ws', () => ({ createClient: jest.fn(() => ({})) }));

import { useAuthStore } from '../store';
import { removeAccessToken } from './auth';
import { bootstrapAuth, refreshTokens, setAuthRedirectForTests } from './apollo-client';
import { requireReplayIdentity, resetAccountLifecycleForTests } from './offline/account-activation';

function buildJwt(sub: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ sub, exp: 9999999999, iat: 1000000000 }));
  return `${header}.${body}.sig`;
}

function okResponse(user: { id: string }, token: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ accessToken: token, user }),
  };
}

const persistedUser = { id: 'user-a', email: 'a@example.com', displayName: 'A' };

describe('auth refresh classification and activation fencing', () => {
  const fetchMock = jest.fn();
  const redirectMock = jest.fn();

  beforeEach(() => {
    resetAccountLifecycleForTests();
    useAuthStore.setState({ user: null, isHydrated: true });
    removeAccessToken();
    localStorage.clear();
    redirectMock.mockReset();
    setAuthRedirectForTests(redirectMock);
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
  });

  afterEach(() => {
    setAuthRedirectForTests(null);
  });

  it('installs a verified subject on a successful refresh', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'user-a' }, buildJwt('user-a')));

    await expect(bootstrapAuth()).resolves.toBe(true);
    expect(useAuthStore.getState().user).toEqual({ id: 'user-a' });
    expect(requireReplayIdentity()).toEqual({ status: 'READY', owner: { subject: 'user-a', epoch: 1 } });
  });

  it('treats a 5xx refresh failure as transient and preserves the local owner', async () => {
    // Establish an owner first.
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'user-a' }, buildJwt('user-a')));
    await bootstrapAuth();
    // Force the next bootstrap to actually refresh, without clearing ownership.
    removeAccessToken();
    useAuthStore.setState({ user: null });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(bootstrapAuth()).resolves.toBe(false);

    // A transient outage must not clear established ownership or pause replay
    // into an auth-required state.
    expect(requireReplayIdentity().status).toBe('READY');
  });

  it('treats a genuine 401 as auth-required without clearing ownership', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'user-a' }, buildJwt('user-a')));
    await bootstrapAuth();
    removeAccessToken();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    await refreshTokens();

    const identity = requireReplayIdentity();
    expect(identity).toEqual({ status: 'PAUSED', reason: 'AUTH_REQUIRED' });
  });

  it('rejects a refresh whose token has no verifiable subject', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'user-a' }, 'not-a-jwt'));

    await expect(bootstrapAuth()).resolves.toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    // C1: bootstrap must never redirect; otherwise the login page reloads into
    // itself and loops.
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('clears and redirects when the REFRESH path token has no verifiable subject (I-4)', async () => {
    useAuthStore.setState({ user: persistedUser as never, isHydrated: true });
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({ state: { user: persistedUser }, version: 0 }),
    );
    fetchMock.mockResolvedValue(okResponse({ id: 'user-a' }, 'not-a-jwt'));

    await expect(refreshTokens()).resolves.toBe(false);

    // Classified as AUTH_REQUIRED: clear the dead session and redirect on the
    // authenticated refresh path.
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('auth-storage')).not.toContain('user-a');
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT redirect when bootstrap gets a genuine 401 (C-1 no self-reload loop)', async () => {
    useAuthStore.setState({ user: persistedUser as never, isHydrated: true });
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({ state: { user: persistedUser }, version: 0 }),
    );
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });

    await expect(bootstrapAuth()).resolves.toBe(false);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('auth-storage')).not.toContain('user-a');
  });

  it('serializes concurrent in-tab refreshes into a single network call', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'user-a' }, buildJwt('user-a')));

    const [a, b] = await Promise.all([refreshTokens(), refreshTokens()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serializes cookie-rotating refreshes on the shared auth-lifecycle lock', async () => {
    const request = jest.fn((_name: string, _options: unknown, run: () => Promise<unknown>) => run());
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request },
    });

    try {
      fetchMock.mockResolvedValue(okResponse({ id: 'user-a' }, buildJwt('user-a')));
      await refreshTokens();
      // The SAME lock is held by login/registration and logout, so a stale
      // Set-Cookie response cannot cross into a newly activated session.
      expect(request).toHaveBeenCalledWith('transformlit-auth-lifecycle', expect.anything(), expect.any(Function));
    } finally {
      Reflect.deleteProperty(globalThis.navigator as Navigator, 'locks');
    }
  });

  describe('destructive-policy separation (C1/C2)', () => {
    function seedPersistedProfile(): void {
      useAuthStore.setState({ user: persistedUser as never, isHydrated: true });
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: { user: persistedUser }, version: 0 }),
      );
    }

    it('preserves the in-memory user and persisted profile on a transient refresh failure', async () => {
      seedPersistedProfile();
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
      await expect(refreshTokens()).resolves.toBe(false);

      expect(useAuthStore.getState().user).toEqual(persistedUser);
      expect(localStorage.getItem('auth-storage')).toContain('user-a');
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('preserves the persisted profile on a cold-start transient bootstrap failure', async () => {
      seedPersistedProfile();
      fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
      await expect(bootstrapAuth()).resolves.toBe(false);

      expect(useAuthStore.getState().user).toEqual(persistedUser);
      expect(localStorage.getItem('auth-storage')).toContain('user-a');
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('preserves state on a network-level refresh failure', async () => {
      seedPersistedProfile();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(refreshTokens()).resolves.toBe(false);

      expect(useAuthStore.getState().user).toEqual(persistedUser);
      expect(localStorage.getItem('auth-storage')).toContain('user-a');
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('clears the session and redirects on a genuine 401', async () => {
      seedPersistedProfile();
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
      await expect(refreshTokens()).resolves.toBe(false);

      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorage.getItem('auth-storage')).not.toContain('user-a');
      expect(redirectMock).toHaveBeenCalledTimes(1);
    });

    it('clears the persisted profile on a 401 even when the in-memory user is null (I-3 pre-hydration)', async () => {
      // Persisted profile exists but the store has not hydrated a user into
      // memory yet.
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({ state: { user: persistedUser }, version: 0 }),
      );
      useAuthStore.setState({ user: null, isHydrated: false });

      fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
      await expect(refreshTokens()).resolves.toBe(false);

      // The persisted store must be cleared unconditionally, not only when an
      // in-memory user happened to be present.
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorage.getItem('auth-storage')).not.toContain('user-a');
      expect(redirectMock).toHaveBeenCalledTimes(1);
    });
  });
});
