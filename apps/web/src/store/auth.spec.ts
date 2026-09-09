import { useAuthStore } from './auth';

jest.mock('../lib/auth', () => ({
  setAccessToken: jest.fn(),
  clearAuth: jest.fn(),
}));

const { setAccessToken, clearAuth: clearAuthStorage } = require('../lib/auth') as {
  setAccessToken: jest.Mock;
  clearAuth: jest.Mock;
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'USER',
  createdAt: '2024-01-01T00:00:00Z',
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
  });

  describe('setAuth', () => {
    it('sets the user', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123');
      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
    });

    it('calls setAccessToken with the access token', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123');
      expect(setAccessToken).toHaveBeenCalledWith('access-token-123');
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
    it('persists only the user to localStorage after setAuth (never a token)', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123');
      const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      expect(stored.state).toEqual({
        user: mockUser,
      });
      expect(stored.state).not.toHaveProperty('token');
    });

    it('does not persist isHydrated', () => {
      useAuthStore.setState({ isHydrated: true });
      useAuthStore.getState().setAuth(mockUser as any, 'tok');
      const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      expect(stored.state).not.toHaveProperty('isHydrated');
    });
  });
});
