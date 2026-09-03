import { render, screen, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockQuery = jest.fn();
const mockMutate = jest.fn();
const mockAddToast = jest.fn();

let mockAuthState: Record<string, unknown> = {
  user: { id: 'u1', displayName: 'Me', avatarUrl: null },
  token: 'test-token',
  isHydrated: true,
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockPush }),
  useParams: () => ({ id: 'u2' }),
}));

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

jest.mock('../../../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
    mutate: mockMutate,
  },
}));

jest.mock('../../../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('../../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  UserAvatar: ({ avatarUrl, displayName }: { avatarUrl?: string | null; displayName?: string }) => (
    <span data-testid="avatar" data-url={avatarUrl ?? ''} aria-label={displayName ?? ''} />
  ),
  BookCard: () => null,
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

import UserProfileClient from './user-profile-client';

const makeProfile = (overrides: Record<string, unknown> = {}) => ({
  userProfile: {
    user: { id: 'u2', displayName: 'Emily', avatarUrl: null, bio: 'Reader', role: 'MEMBER' },
    friendCount: 3,
    groupCount: 2,
    bookCount: 5,
    bookProgress: [],
    groups: [],
    mutualFriends: [
      { id: 'm1', displayName: 'Grace', avatarUrl: null },
      { id: 'm2', displayName: 'Sam', avatarUrl: 'https://example.com/sam.png' },
    ],
    ...overrides,
  },
});

describe('UserProfileClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockAuthState = {
      user: { id: 'u1', displayName: 'Me', avatarUrl: null },
      token: 'test-token',
      isHydrated: true,
    };
  });

  const renderProfile = (profile: Record<string, unknown>) => {
    mockQuery
      .mockResolvedValueOnce({ data: profile })
      .mockResolvedValueOnce({ data: { friendshipStatus: null } });
    render(<UserProfileClient />);
    return waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());
  };

  it('requests mutualFriends and renders them with avatars for another profile', async () => {
    await renderProfile(makeProfile());

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('mutualFriends') }),
    );
    expect(screen.getByText('Mutual Friends')).toBeInTheDocument();
    expect(screen.getAllByText('Grace').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0);
    const samAvatar = screen
      .getAllByTestId('avatar')
      .find((el) => el.getAttribute('data-url') === 'https://example.com/sam.png');
    expect(samAvatar).toBeDefined();
  });

  it('hides the Mutual Friends section when there are no mutual friends', async () => {
    await renderProfile(makeProfile({ mutualFriends: [] }));

    expect(screen.queryByText('Mutual Friends')).not.toBeInTheDocument();
  });

  it('hides the Mutual Friends section on the user own profile', async () => {
    mockAuthState = {
      user: { id: 'u2', displayName: 'Emily', avatarUrl: null },
      token: 'test-token',
      isHydrated: true,
    };
    await renderProfile(makeProfile());

    expect(screen.queryByText('Mutual Friends')).not.toBeInTheDocument();
  });

  it('keeps the Message button for accepted friendships', async () => {
    mockQuery
      .mockResolvedValueOnce({ data: makeProfile({ mutualFriends: [] }) })
      .mockResolvedValueOnce({
        data: { friendshipStatus: { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'ACCEPTED' } },
      });

    render(<UserProfileClient />);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /message/i })).toBeInTheDocument();
  });
});