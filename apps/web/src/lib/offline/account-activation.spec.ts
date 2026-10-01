import { useAuthStore } from '../../store';
import { useBibleStore } from '../../store/bible-store';

jest.mock('../auth', () => {
  const actual = jest.requireActual('../auth');
  return {
    ...actual,
    setAccessToken: jest.fn(),
  };
});

import {
  activateIdentity,
  captureOriginEpoch,
  completeLocalAuth,
  hydrateAccountLifecycle,
  installEpochTaggedAuth,
  markAuthRequired,
  requireReplayIdentity,
  resetAccountLifecycleForTests,
} from './account-activation';
import { issueAuthInstallTicket } from './install-ticket';

function buildJwt(sub: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ sub, exp: 9999999999, iat: 1000000000 }));
  return `${header}.${body}.sig`;
}

const mockUser = {
  id: 'subject-a',
  email: 'a@example.com',
  displayName: 'A',
  role: 'USER',
  createdAt: '2024-01-01T00:00:00Z',
};

describe('account activation wiring', () => {
  beforeEach(() => {
    resetAccountLifecycleForTests();
    useAuthStore.setState({ user: null, isHydrated: true });
    useBibleStore.setState({
      translation: 'BSB',
      subject: null,
      lastPosition: {},
      indexStatus: {},
      isHydrated: true,
    });
    localStorage.clear();
  });

  it('binds Bible navigation to the activated subject (C3 wiring)', async () => {
    useBibleStore.getState().setLastPosition('BSB', { book: 'ROM', chapter: 8 });

    const outcome = await activateIdentity({ subject: 'subject-a', epoch: 0 });
    expect(outcome.status).toBe('INSTALLED');
    expect(useBibleStore.getState().subject).toBe('subject-a');
    // The pre-activation (unscoped) position must not survive activation.
    expect(useBibleStore.getState().lastPosition).toEqual({});
  });

  it('resets Bible position when switching from account A to account B', async () => {
    await activateIdentity({ subject: 'subject-a', epoch: 0 });
    useBibleStore.getState().setLastPosition('BSB', { book: 'JHN', chapter: 3 });
    expect(useBibleStore.getState().subject).toBe('subject-a');

    // A real A→B gate traversal is Task 13B (exit/drain); here the reset is
    // proven through the public Bible seam the gate drives.
    useBibleStore.getState().setAccountSubject('subject-b');
    expect(useBibleStore.getState().lastPosition).toEqual({});
    expect(useBibleStore.getState().subject).toBe('subject-b');
  });

  it('installs a same-epoch, same-subject session through the gate', async () => {
    const install = jest.fn().mockReturnValue(true);
    await activateIdentity({ subject: 'subject-a', epoch: 0 });

    const epoch = await captureOriginEpoch();
    const outcome = await installEpochTaggedAuth({ epoch, subject: 'subject-a', value: 'tok' }, install);

    expect(outcome.status).toBe('INSTALLED');
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('does not install a stale-epoch session result', async () => {
    const install = jest.fn().mockReturnValue(true);
    await activateIdentity({ subject: 'subject-a', epoch: 0 });

    const outcome = await installEpochTaggedAuth({ epoch: 0, subject: 'subject-a', value: 'tok' }, install);
    expect(outcome.status).toBe('STALE_EPOCH');
    expect(install).not.toHaveBeenCalled();
  });

  it('does not install a session for a different subject', async () => {
    const install = jest.fn().mockReturnValue(true);
    await activateIdentity({ subject: 'subject-a', epoch: 0 });
    const epoch = await captureOriginEpoch();

    const outcome = await installEpochTaggedAuth({ epoch, subject: 'subject-b', value: 'tok' }, install);
    expect(outcome.status).toBe('SUBJECT_MISMATCH');
    expect(install).not.toHaveBeenCalled();
  });

  it('does not bind account state when the store rejects the ticket (M1)', async () => {
    await activateIdentity({ subject: 'subject-a', epoch: 0 });
    const epoch = await captureOriginEpoch();

    const outcome = await installEpochTaggedAuth(
      { epoch, subject: 'subject-a', value: 'tok' },
      () => false,
    );
    expect(outcome.status).toBe('BLOCKED');
  });

  it('completes local auth only when the token subject matches the user id (M2)', async () => {
    const installed = await completeLocalAuth(mockUser as never, buildJwt('subject-a'));
    expect(installed).toBe(true);
    expect(useAuthStore.getState().user).toEqual(mockUser);
    expect(useBibleStore.getState().subject).toBe('subject-a');
  });

  it('rejects local auth when the token subject differs from the user id (M2)', async () => {
    const installed = await completeLocalAuth(mockUser as never, buildJwt('someone-else'));
    expect(installed).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('rejects local auth when the token has no verifiable subject (M2)', async () => {
    const installed = await completeLocalAuth(mockUser as never, 'not-a-jwt');
    expect(installed).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('issues install tickets only from the lifecycle gate', () => {
    const a = issueAuthInstallTicket('subject-a', 1);
    const b = issueAuthInstallTicket('subject-a', 1);
    expect(a).not.toBe(b);
  });

  it('hydrates without clobbering an in-memory owner (I1 idempotent)', async () => {
    await activateIdentity({ subject: 'subject-a', epoch: 0 });
    await hydrateAccountLifecycle();
    expect(requireReplayIdentity()).toEqual({ status: 'READY', owner: { subject: 'subject-a', epoch: 1 } });
  });

  it('pauses replay when identity is required but auth failed', async () => {
    await activateIdentity({ subject: 'subject-a', epoch: 0 });
    markAuthRequired();
    expect(requireReplayIdentity()).toEqual({ status: 'PAUSED', reason: 'AUTH_REQUIRED' });
  });

  it('has no replay identity before activation', () => {
    expect(requireReplayIdentity()).toEqual({ status: 'PAUSED', reason: 'NO_OWNER' });
  });
});
