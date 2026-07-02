import { useAuthStore } from './auth';

jest.mock('../lib/auth', () => ({
  setAccessToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearAuth: jest.fn(),
}));

const { setAccessToken, setRefreshToken, clearAuth: clearAuthStorage } =
  require('../lib/auth') as {
    setAccessToken: jest.Mock;
    setRefreshToken: jest.Mock;
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
      token: null,
      isHydrated: false,
    });
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('has null user and null token', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
    });

    it('has isHydrated false', () => {
      expect(useAuthStore.getState().isHydrated).toBe(false);
    });
  });

  describe('setAuth', () => {
    it('sets user and token', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123');
      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.token).toBe('access-token-123');
    });

    it('calls setAccessToken with the token', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123');
      expect(setAccessToken).toHaveBeenCalledWith('access-token-123');
    });

    it('calls setRefreshToken when refreshToken is provided', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123', 'refresh-token-456');
      expect(setRefreshToken).toHaveBeenCalledWith('refresh-token-456');
    });

    it('does not call setRefreshToken when refreshToken is not provided', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123');
      expect(setRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('clearAuth', () => {
    it('clears user and token', () => {
      useAuthStore.setState({ user: mockUser as any, token: 'some-token' });
      useAuthStore.getState().clearAuth();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
    });

    it('calls clearAuthStorage', () => {
      useAuthStore.getState().clearAuth();
      expect(clearAuthStorage).toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    it('persists user and token to localStorage after setAuth', () => {
      useAuthStore.getState().setAuth(mockUser as any, 'access-token-123');
      const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      expect(stored.state).toEqual({
        user: mockUser,
        token: 'access-token-123',
      });
    });

    it('does not persist isHydrated', () => {
      useAuthStore.setState({ isHydrated: true });
      useAuthStore.getState().setAuth(mockUser as any, 'tok');
      const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      expect(stored.state).not.toHaveProperty('isHydrated');
    });
  });
});
