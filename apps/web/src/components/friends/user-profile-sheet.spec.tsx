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
  ConfirmDialog: ({
    open,
    onClose,
    onConfirm,
    title,
    confirmLabel = 'Confirm',
  }: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    confirmLabel?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <p>{title}</p>
        <button onClick={onClose}>Cancel</button>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
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

const noFriendship = { friendshipStatus: null };

const incomingFriendship = {
  friendshipStatus: { id: 'f3', requesterId: 'u2', addresseeId: 'u1', status: 'PENDING' },
};

describe('UserProfileSheet', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockPush.mockClear();
    mockOnClose.mockClear();
    mockAddToast.mockClear();
  });

  const renderSheet = (friendshipData: { friendshipStatus: unknown }) => {
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

  it('asks for confirmation before sending a friend request', async () => {
    renderSheet(noFriendship);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());

    mockMutate.mockResolvedValueOnce({
      data: { sendFriendRequest: { id: 'f1', status: 'PENDING' } },
    });

    fireEvent.click(screen.getByRole('button', { name: /add friend/i }));

    expect(screen.getByText('Send friend request?')).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Send Request' }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { addresseeId: 'u2' } }),
      );
      expect(mockAddToast).toHaveBeenCalledWith('Friend request sent!', 'success');
    });
  });

  it('does not send the request when the add-friend confirmation is cancelled', async () => {
    renderSheet(noFriendship);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add friend/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('accepts an incoming request without a confirmation step', async () => {
    renderSheet(incomingFriendship);

    await waitFor(() => expect(screen.getByText('Emily')).toBeInTheDocument());

    mockMutate.mockResolvedValueOnce({
      data: { acceptFriendRequest: { id: 'f3', status: 'ACCEPTED' } },
    });

    fireEvent.click(screen.getByRole('button', { name: /accept request/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { friendshipId: 'f3' } }),
      );
    });
  });
});