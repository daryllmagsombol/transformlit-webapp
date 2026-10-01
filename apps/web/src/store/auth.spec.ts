import { useAuthStore } from './auth';
import { issueAuthInstallTicket } from '../lib/auth';

jest.mock('../lib/auth', () => {
  const actual = jest.requireActual('../lib/auth');
  return {
    ...actual,
    setAccessToken: jest.fn(),
    clearAuth: jest.fn(),
    issueAuthInstallTicket: jest.fn(),
    isAuthInstallTicket: jest.fn(),
  };
});

const {
  setAccessToken,
  clearAuth: clearAuthStorage,
  issueAuthInstallTicket: issueTicket,
  isAuthInstallTicket,
} = require('../lib/auth') as {
  setAccessToken: jest.Mock;
  clearAuth: jest.Mock;
  issueAuthInstallTicket: jest.Mock;
  isAuthInstallTicket: jest.Mock;
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'USER',
  createdAt: '2024-01-01T00:00:00Z',
};

const realTicket = () => {
  const actual = jest.requireActual('../lib/auth') as typeof import('../lib/auth');
  return actual.issueAuthInstallTicket('user-1', 1);
};

describe('Auth Store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isHydrated: false,
    });
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('has null user', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
    });

    it('has isHydrated false', () => {
      expect(useAuthStore.getState().isHydrated).toBe(false);
    });

    it('does not expose a direct, ungated auth setter', () => {
      const state = useAuthStore.getState() as unknown as Record<string, unknown>;
      expect('setAuth' in state).toBe(false);
      expect('setUser' in state).toBe(false);
    });
  });

  describe('installAuth', () => {
    it('installs the user when presented a valid lifecycle ticket', () => {
      isAuthInstallTicket.mockReturnValue(true);
      const ticket = realTicket();

      const installed = useAuthStore.getState().installAuth(mockUser as any, 'access-token-123', ticket);
      expect(installed).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(setAccessToken).toHaveBeenCalledWith('access-token-123');
    });

    it('fails closed and installs nothing without a valid ticket', () => {
      isAuthInstallTicket.mockReturnValue(false);
      const ticket = { subject: 'user-1', epoch: 1 };

      const installed = useAuthStore.getState().installAuth(mockUser as any, 'access-token-123', ticket);
      expect(installed).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(setAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a forged ticket object that never passed the lifecycle gate', () => {
      // Use the real implementation so a plain object ticket is rejected.
      const actual = jest.requireActual('../lib/auth') as typeof import('../lib/auth');
      isAuthInstallTicket.mockImplementation(actual.isAuthInstallTicket);

      const installed = useAuthStore
        .getState()
        .installAuth(mockUser as any, 'tok', { subject: 'user-1', epoch: 1 } as never);
      expect(installed).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe('clearAuth', () => {
    it('clears the user', () => {
      useAuthStore.setState({ user: mockUser as any });
      useAuthStore.getState().clearAuth();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
    });

    it('calls clearAuthStorage', () => {
      useAuthStore.getState().clearAuth();
      expect(clearAuthStorage).toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    it('persists only the user to localStorage after installAuth (never a token)', () => {
      isAuthInstallTicket.mockReturnValue(true);
      useAuthStore.getState().installAuth(mockUser as any, 'access-token-123', realTicket());
      const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      expect(stored.state).toEqual({
        user: mockUser,
      });
      expect(stored.state).not.toHaveProperty('token');
    });

    it('does not persist isHydrated', () => {
      isAuthInstallTicket.mockReturnValue(true);
      useAuthStore.setState({ isHydrated: true });
      useAuthStore.getState().installAuth(mockUser as any, 'tok', realTicket());
      const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      expect(stored.state).not.toHaveProperty('isHydrated');
    });
  });
});
