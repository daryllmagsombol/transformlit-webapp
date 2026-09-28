import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockMutate = jest.fn();
const mockAddToast = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    mutate: mockMutate,
  },
}));

jest.mock('../../lib/groups', () => ({
  resolveImageUrl: () => undefined,
  JOIN_GROUP_MUTATION: 'JOIN_GROUP_MUTATION',
  LEAVE_GROUP_MUTATION: 'LEAVE_GROUP_MUTATION',
}));

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  ConfirmDialog: ({
    open,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirm',
  }: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <p>{title}</p>
        <p>{message}</p>
        <button onClick={onClose}>Cancel</button>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

import { GroupHeader } from './group-header';

const baseGroup = {
  id: 'g1',
  name: 'Sci-Fi Readers',
  slug: 'sci-fi-readers',
  description: 'A group',
  visibility: 'PUBLIC',
  category: 'SCI_FI',
  coverImageUrl: null,
  featured: false,
  memberCount: 12,
  myRole: null,
  myStatus: null,
  createdAt: '2025-01-01T00:00:00Z',
};

function renderHeader(group: typeof baseGroup) {
  return render(
    <GroupHeader group={group} onChanged={jest.fn()} onTabChange={jest.fn()} activeTab="posts" />,
  );
}

describe('GroupHeader join confirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms before joining a public group and joins immediately on confirm', async () => {
    mockMutate.mockResolvedValueOnce({ data: { joinGroup: { id: 'g1', status: 'ACTIVE' } } });
    renderHeader(baseGroup);

    fireEvent.click(screen.getByRole('button', { name: /join group/i }));

    expect(screen.getByText('Join this group?')).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Join Group' }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { groupId: 'g1' } }),
      );
      expect(mockAddToast).toHaveBeenCalledWith('Joined group! Welcome aboard.', 'success');
    });
  });

  it('describes a private group as a join request', async () => {
    mockMutate.mockResolvedValueOnce({ data: { joinGroup: { id: 'g1', status: 'PENDING' } } });
    renderHeader({ ...baseGroup, visibility: 'PRIVATE' });

    fireEvent.click(screen.getByRole('button', { name: /join group/i }));

    expect(screen.getByText('Request to join?')).toBeInTheDocument();
    expect(screen.getByText(/admin will review it/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send Request' }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Request sent.', 'success');
    });
  });

  it('does not join when the confirmation is cancelled', () => {
    renderHeader(baseGroup);

    fireEvent.click(screen.getByRole('button', { name: /join group/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockMutate).not.toHaveBeenCalled();
  });
});
