import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockQuery = jest.fn();
const mockMutate = jest.fn();

let mockAuthState: Record<string, unknown> = {
  user: { id: 'u1', displayName: 'Owner', avatarUrl: null },
  isHydrated: true,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
    mutate: mockMutate,
  },
}));

const mockAddToast = jest.fn();

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

import { GroupMembers } from './group-members';

const pendingMember = {
  id: 'm1',
  userId: 'u2',
  role: 'MEMBER',
  status: 'PENDING',
  joinedAt: '2025-01-01T00:00:00Z',
  user: { id: 'u2', displayName: 'Emily', avatarUrl: null },
};

const activeMember = {
  id: 'm2',
  userId: 'u3',
  role: 'MEMBER',
  status: 'ACTIVE',
  joinedAt: '2025-01-01T00:00:00Z',
  user: { id: 'u3', displayName: 'David', avatarUrl: null },
};

const bannedMember = {
  id: 'm3',
  userId: 'u4',
  role: 'MEMBER',
  status: 'BANNED',
  joinedAt: '2025-01-01T00:00:00Z',
  user: { id: 'u4', displayName: 'Michael', avatarUrl: null },
};

describe('GroupMembers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockAuthState = {
      user: { id: 'u1', displayName: 'Owner', avatarUrl: null },
      isHydrated: true,
    };
  });

  it('Approve button calls approveGroupMember mutation', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupMembers: [pendingMember] } });
    mockMutate.mockResolvedValueOnce({ data: { approveGroupMember: { id: 'm1', status: 'ACTIVE' } } });

    render(<GroupMembers groupId="g1" canModerate isOwner />);

    await waitFor(() => {
      expect(screen.getByText('Emily')).toBeInTheDocument();
    });

    const approveButton = screen.getByRole('button', { name: /approve/i });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { groupId: 'g1', userId: 'u2' },
        }),
      );
    });
  });

  it('admin menu shows Ban and Remove actions for owner', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupMembers: [activeMember] } });
    render(<GroupMembers groupId="g1" canModerate isOwner />);

    await waitFor(() => {
      expect(screen.getByText('David')).toBeInTheDocument();
    });

    const menuButton = screen.getByLabelText('Member options');
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByText('Ban')).toBeInTheDocument();
      expect(screen.getByText('Remove')).toBeInTheDocument();
    });
  });

  it('plain member sees member list but no admin actions', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupMembers: [activeMember] } });
    render(<GroupMembers groupId="g1" canModerate={false} isOwner={false} />);

    await waitFor(() => {
      expect(screen.getByText('David')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Member options')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending requests')).not.toBeInTheDocument();
  });

  it('Ban button calls banGroupMember mutation', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupMembers: [activeMember] } });
    mockMutate.mockResolvedValueOnce({ data: { banGroupMember: { id: 'm2', status: 'BANNED' } } });
    window.confirm = jest.fn(() => true);

    render(<GroupMembers groupId="g1" canModerate isOwner />);

    await waitFor(() => {
      expect(screen.getByText('David')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Member options'));
    await waitFor(() => expect(screen.getByText('Ban')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ban'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { groupId: 'g1', userId: 'u3' },
        }),
      );
    });
  });

  it('Unban button calls unbanGroupMember mutation', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupMembers: [bannedMember] } });
    mockMutate.mockResolvedValueOnce({ data: { unbanGroupMember: { id: 'm3', status: 'ACTIVE' } } });
    window.confirm = jest.fn(() => true);

    render(<GroupMembers groupId="g1" canModerate isOwner />);

    await waitFor(() => {
      expect(screen.getByText('Michael')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Member options'));
    await waitFor(() => expect(screen.getByText('Unban')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Unban'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { groupId: 'g1', userId: 'u4' },
        }),
      );
    });
  });

  it('Remove button calls removeGroupMember mutation', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupMembers: [activeMember] } });
    mockMutate.mockResolvedValueOnce({ data: { removeGroupMember: true } });
    window.confirm = jest.fn(() => true);

    render(<GroupMembers groupId="g1" canModerate isOwner />);

    await waitFor(() => {
      expect(screen.getByText('David')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Member options'));
    await waitFor(() => expect(screen.getByText('Remove')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { groupId: 'g1', userId: 'u3' },
        }),
      );
    });
  });
});
