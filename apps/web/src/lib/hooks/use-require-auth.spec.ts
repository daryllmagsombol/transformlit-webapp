import { renderHook } from '@testing-library/react';

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

let mockAuthState: Record<string, unknown> = {
  token: null,
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
    mockAuthState = { token: null, isHydrated: false };
  });

  it('returns isReady=false when not hydrated', () => {
    mockAuthState = { token: 'test-token', isHydrated: false };
    const { result } = renderHook(() => useRequireAuth());
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=false when hydrated but no token', () => {
    mockAuthState = { token: null, isHydrated: true };
    const { result } = renderHook(() => useRequireAuth());
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=true when hydrated with token', () => {
    mockAuthState = { token: 'test-token', isHydrated: true };
    const { result } = renderHook(() => useRequireAuth());
    expect(result.current.isReady).toBe(true);
  });

  it('does not redirect while not hydrated', () => {
    mockAuthState = { token: null, isHydrated: false };
    renderHook(() => useRequireAuth());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('redirects to /login when hydrated without token', () => {
    mockAuthState = { token: null, isHydrated: true };
    renderHook(() => useRequireAuth());
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('does not redirect when hydrated with token', () => {
    mockAuthState = { token: 'test-token', isHydrated: true };
    renderHook(() => useRequireAuth());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
