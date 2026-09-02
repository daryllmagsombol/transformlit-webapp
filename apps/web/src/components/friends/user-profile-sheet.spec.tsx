import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockQuery = jest.fn();
const mockMutate = jest.fn();
const mockPush = jest.fn();
const mockOnClose = jest.fn();
const mockAddToast = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
    mutate: mockMutate,
  },
}));

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  UserAvatar: () => null,
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

import { UserProfileSheet } from './user-profile-sheet';

const profileFixture = {
  userProfile: {
    user: { id: 'u2', displayName: 'Emily', avatarUrl: null, bio: 'Reader', role: 'MEMBER' },
    friendCount: 3,
    groupCount: 2,
    bookCount: 5,
    bookProgress: [],
    groups: [],
  },
};

const acceptedFriendship = {
  friendshipStatus: { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'ACCEPTED' },
};

const pendingFriendship = {
  friendshipStatus: { id: 'f2', requesterId: 'u1', addresseeId: 'u2', status: 'PENDING' },
};

describe('UserProfileSheet', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockPush.mockClear();
    mockOnClose.mockClear();
    mockAddToast.mockClear();
  });

  const renderSheet = (friendshipData: typeof acceptedFriendship) => {
    mockQuery
      .mockResolvedValueOnce({ data: profileFixture })
      .mockResolvedValueOnce({ data: friendshipData });
    render(<UserProfileSheet userId="u2" open currentUserId="u1" onClose={mockOnClose} />);
  };

  it('renders the Message button only when friendship is ACCEPTED', async () => {
    renderSheet(acceptedFriendship);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /message/i })).toBeInTheDocument();
  });

  it('hides the Message button when friendship is not ACCEPTED', async () => {
    renderSheet(pendingFriendship);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /message/i })).not.toBeInTheDocument();
  });

  it('starts a direct conversation and navigates to it when Message is tapped', async () => {
    renderSheet(acceptedFriendship);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());

    mockMutate.mockResolvedValueOnce({ data: { startDirectConversation: { id: 'c1' } } });

    fireEvent.click(screen.getByRole('button', { name: /message/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { otherUserId: 'u2' } }),
      );
      expect(mockPush).toHaveBeenCalledWith('/chat/c1');
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows a toast and does not navigate when the mutation fails', async () => {
    renderSheet(acceptedFriendship);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());

    mockMutate.mockRejectedValueOnce(new Error('nope'));

    fireEvent.click(screen.getByRole('button', { name: /message/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('You can only message your friends.', 'error');
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});