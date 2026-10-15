import { renderHook } from '@testing-library/react';

// The web Jest harness cannot transform the ESM `@transformlit/shared` dist
// (existing web specs only ever `import type`). UserRole is consumed as a value
// here, so it is mocked with its real string members.
jest.mock('@transformlit/shared', () => ({
  UserRole: { ADMIN: 'ADMIN', MODERATOR: 'MODERATOR', MEMBER: 'MEMBER' },
}));

import { UserRole } from '@transformlit/shared';

const mockReplace = jest.fn();
const mockPush = jest.fn();

let mockPathname: string | null = null;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => mockPathname,
}));

const mockAdmin = {
  id: 'a1',
  email: 'admin@example.com',
  displayName: 'Admin',
  avatarUrl: null,
  role: UserRole.ADMIN,
};

const mockModerator = {
  id: 'm1',
  email: 'mod@example.com',
  displayName: 'Moderator',
  avatarUrl: null,
  role: UserRole.MODERATOR,
};

const mockMember = {
  id: 'u1',
  email: 'member@example.com',
  displayName: 'Member',
  avatarUrl: null,
  role: UserRole.MEMBER,
};

let mockAuthState: Record<string, unknown> = {
  user: null,
  isHydrated: false,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

import { useRequireRole } from './use-require-role';

const STAFF: UserRole[] = [UserRole.ADMIN, UserRole.MODERATOR];

describe('useRequireRole', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    mockPathname = null;
    mockAuthState = { user: null, isHydrated: false };
  });

  it('returns isReady=false when not hydrated', () => {
    mockAuthState = { user: mockAdmin, isHydrated: false };
    const { result } = renderHook(() => useRequireRole(...STAFF));
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=false when hydrated but no user', () => {
    mockAuthState = { user: null, isHydrated: true };
    const { result } = renderHook(() => useRequireRole(...STAFF));
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=false when hydrated with a non-staff user', () => {
    mockAuthState = { user: mockMember, isHydrated: true };
    const { result } = renderHook(() => useRequireRole(...STAFF));
    expect(result.current.isReady).toBe(false);
  });

  it('returns isReady=true for an ADMIN', () => {
    mockAuthState = { user: mockAdmin, isHydrated: true };
    const { result } = renderHook(() => useRequireRole(...STAFF));
    expect(result.current.isReady).toBe(true);
  });

  it('returns isReady=true for a MODERATOR', () => {
    mockAuthState = { user: mockModerator, isHydrated: true };
    const { result } = renderHook(() => useRequireRole(...STAFF));
    expect(result.current.isReady).toBe(true);
  });

  it('returns isReady=true only for the explicitly allowed roles', () => {
    mockAuthState = { user: mockModerator, isHydrated: true };
    const { result } = renderHook(() => useRequireRole(UserRole.ADMIN));
    expect(result.current.isReady).toBe(false);
  });

  it('does not redirect while not hydrated', () => {
    mockAuthState = { user: null, isHydrated: false };
    renderHook(() => useRequireRole(...STAFF));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('redirects to /login when hydrated without a user', () => {
    mockAuthState = { user: null, isHydrated: true };
    renderHook(() => useRequireRole(...STAFF));
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('preserves the intended path via a redirect query when unauthenticated', () => {
    mockPathname = '/admin';
    mockAuthState = { user: null, isHydrated: true };
    renderHook(() => useRequireRole(...STAFF));
    expect(mockPush).toHaveBeenCalledWith('/login?redirect=%2Fadmin');
  });

  it('redirects to /feed when hydrated with a non-staff user', () => {
    mockAuthState = { user: mockMember, isHydrated: true };
    renderHook(() => useRequireRole(...STAFF));
    expect(mockPush).toHaveBeenCalledWith('/feed');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not redirect an ADMIN', () => {
    mockAuthState = { user: mockAdmin, isHydrated: true };
    renderHook(() => useRequireRole(...STAFF));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not redirect a MODERATOR', () => {
    mockAuthState = { user: mockModerator, isHydrated: true };
    renderHook(() => useRequireRole(...STAFF));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
