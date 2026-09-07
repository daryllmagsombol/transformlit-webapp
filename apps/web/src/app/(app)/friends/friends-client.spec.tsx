import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockPush = jest.fn();
const mockQuery = jest.fn();
const mockMutate = jest.fn();
const mockAddToast = jest.fn();

let mockAuthState: Record<string, unknown> = {
  user: { id: 'u1', displayName: 'Test User', avatarUrl: null },
  isHydrated: true,
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
}));

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

jest.mock('../../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
    mutate: mockMutate,
  },
}));

jest.mock('../../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  FriendCard: () => null,
  FriendRequestItem: () => null,
  SuggestedFriendCard: ({ name, tag, onAdd }: { name: string; tag: string; onAdd: () => void }) => (
    <div>
      <span>{name}</span>
      <span>{tag}</span>
      <button onClick={onAdd}>Add Friend</button>
    </div>
  ),
  UserSearchInput: () => null,
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
  Modal: () => null,
}));

jest.mock('../../../components/friends/user-profile-sheet', () => ({
  UserProfileSheet: () => null,
}));

import FriendsClient from './friends-client';

describe('FriendsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockAuthState = {
      user: { id: 'u1', displayName: 'Test User', avatarUrl: null },
      isHydrated: true,
    };
  });

  const mockSuggestionLoad = (suggestions: Array<Record<string, unknown>>) => {
    mockQuery
      .mockResolvedValueOnce({ data: { friends: [] } })
      .mockResolvedValueOnce({ data: { friendRequests: [] } })
      .mockResolvedValueOnce({ data: { suggestedFriends: suggestions } });
  };

  it('renders suggested friends from the query with limit 5', async () => {
    mockSuggestionLoad([
      { id: 's1', displayName: 'Ada Lovelace', avatarUrl: null, bio: 'Math & Poetry' },
    ]);

    render(<FriendsClient />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    expect(screen.getByText('Math & Poetry')).toBeInTheDocument();
    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({ variables: { limit: 5 } }));
  });

  it('does not render mock suggestions and shows the empty message when there are none', async () => {
    mockSuggestionLoad([]);

    render(<FriendsClient />);

    await waitFor(() =>
      expect(screen.getByText('No suggestions right now — check back soon.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Leo T.')).not.toBeInTheDocument();
  });

  it('falls back to "Community member" tag when a suggestion has no bio', async () => {
    mockSuggestionLoad([{ id: 's1', displayName: 'Ada Lovelace', avatarUrl: null, bio: null }]);

    render(<FriendsClient />);

    await waitFor(() => expect(screen.getByText('Community member')).toBeInTheDocument());
  });

  it('sends a friend request, shows a success toast, and removes the card', async () => {
    mockSuggestionLoad([{ id: 's1', displayName: 'Ada Lovelace', avatarUrl: null, bio: null }]);

    render(<FriendsClient />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    mockMutate.mockResolvedValueOnce({ data: { sendFriendRequest: { id: 'f1', status: 'PENDING' } } });

    fireEvent.click(screen.getByText('Add Friend'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { addresseeId: 's1' } }),
      );
      expect(mockAddToast).toHaveBeenCalledWith('Friend request sent!', 'success');
    });
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('shows an error toast and keeps the card when the request fails', async () => {
    mockSuggestionLoad([{ id: 's1', displayName: 'Ada Lovelace', avatarUrl: null, bio: null }]);

    render(<FriendsClient />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

    mockMutate.mockRejectedValueOnce(new Error('nope'));

    fireEvent.click(screen.getByText('Add Friend'));

    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith('Failed to send friend request.', 'error'),
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });
});