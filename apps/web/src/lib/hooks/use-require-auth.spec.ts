import { renderHook } from '@testing-library/react';

const mockReplace = jest.fn();
const mockPush = jest.fn();

let mockPathname: string | null = null;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => mockPathname,
}));

const mockUser = { id: 'u1', email: 'test@example.com', displayName: 'Test', avatarUrl: null };

let mockAuthState: Record<string, unknown> = {
  user: null,
  isHydrated: false,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

import { useRequireAuth } from './use-require-auth';

describe('useRequireAuth', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    mockPathname = null;
    mockAuthState = { user: null, isHydrated: false };
  });

  it('returns isReady=false when not hydrated', () => {
    mockAuthState = { user: mockUser, isHydrated: false };
    const { result } = renderHook(() => useRequireAuth());
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=false when hydrated but no user', () => {
    mockAuthState = { user: null, isHydrated: true };
    const { result } = renderHook(() => useRequireAuth());
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=true when hydrated with a user', () => {
    mockAuthState = { user: mockUser, isHydrated: true };
    const { result } = renderHook(() => useRequireAuth());
    expect(result.current.isReady).toBe(true);
  });

  it('does not redirect while not hydrated', () => {
    mockAuthState = { user: null, isHydrated: false };
    renderHook(() => useRequireAuth());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('redirects to /login when hydrated without a user', () => {
    mockAuthState = { user: null, isHydrated: true };
    renderHook(() => useRequireAuth());
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('does not redirect when hydrated with a user', () => {
    mockAuthState = { user: mockUser, isHydrated: true };
    renderHook(() => useRequireAuth());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('preserves the intended path via a redirect query when hydrated without a user', () => {
    mockPathname = '/friends';
    mockAuthState = { user: null, isHydrated: true };
    renderHook(() => useRequireAuth());
    expect(mockPush).toHaveBeenCalledWith('/login?redirect=%2Ffriends');
  });

  it('redirects to /login without a redirect query while already on /login', () => {
    mockPathname = '/login';
    mockAuthState = { user: null, isHydrated: true };
    renderHook(() => useRequireAuth());
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('redirects to plain /login when the current path is unknown', () => {
    mockPathname = null;
    mockAuthState = { user: null, isHydrated: true };
    renderHook(() => useRequireAuth());
    expect(mockPush).toHaveBeenCalledWith('/login');
  });
});
