import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockPush = jest.fn();
const mockQuery = jest.fn();
const mockMutate = jest.fn();
const mockAddToast = jest.fn();

let mockIsReady = true;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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

jest.mock('../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: mockIsReady }),
}));

jest.mock('../../../lib/time', () => ({
  relativeTime: () => 'some time ago',
}));

jest.mock('../../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  NotificationItem: ({
    body,
    timestamp,
    read,
    onPress,
    children,
  }: {
    body: string;
    timestamp: string;
    read: boolean;
    onPress: () => void;
    children?: React.ReactNode;
  }) => (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={onPress}
      data-read={String(read)}
      aria-label={`Notification: ${body}`}
    >
      <span>{body}</span>
      <span>{timestamp}</span>
      {children}
    </div>
  ),
}));

jest.mock('../../../components/ui/stagger', () => ({
  Stagger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import NotificationsClient from './notifications-client';

const NOW = Date.now();
const iso = (offsetDays: number) => new Date(NOW - offsetDays * 86400000).toISOString();

const baseNotification = {
  id: 'n1',
  type: 'FRIEND_REQUEST',
  payload: { fromName: 'Alice', friendshipId: 'f1' },
  readAt: null,
  createdAt: iso(0),
};

function renderClient() {
  return render(<NotificationsClient />);
}

describe('NotificationsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsReady = true;
    mockQuery.mockResolvedValue({ data: { notifications: [] } });
    mockMutate.mockResolvedValue({ data: {} });
  });

  beforeAll(() => {
    if (!globalThis.crypto?.randomUUID) {
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: () => `key-${Math.random()}` },
        configurable: true,
      });
    }
  });

  it('shows the loading skeleton then the empty state', async () => {
    mockQuery.mockResolvedValueOnce({ data: { notifications: [] } });
    renderClient();

    expect(document.querySelectorAll('.animate-pulse').length).toBe(5);

    await waitFor(() => expect(screen.getByText('All caught up!')).toBeInTheDocument());
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { limit: 50 } }),
    );
  });

  it('shows an error toast when loading fails but still leaves the loading state', async () => {
    mockQuery.mockRejectedValueOnce(new Error('network'));
    renderClient();

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Failed to load notifications.', 'error');
    });
    expect(screen.getByText('All caught up!')).toBeInTheDocument();
  });

  it('does not fetch while auth is not ready', async () => {
    mockIsReady = false;
    renderClient();

    await waitFor(() => expect(screen.queryByText('All caught up!')).not.toBeInTheDocument());
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('renders grouped notifications with body copy and a Today counter', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        notifications: [
          baseNotification,
          { id: 'n2', type: 'FRIEND_ACCEPTED', payload: { fromName: 'Bob' }, readAt: null, createdAt: iso(0) },
          { id: 'n3', type: 'GROUP_INVITE', payload: {}, readAt: '2025-01-01T00:00:00Z', createdAt: iso(1) },
          { id: 'n4', type: 'GROUP_UPDATE', payload: {}, readAt: '2025-01-01T00:00:00Z', createdAt: iso(3) },
          { id: 'n5', type: 'SOMETHING_ELSE', payload: {}, readAt: '2025-01-01T00:00:00Z', createdAt: iso(30) },
        ],
      },
    });

    renderClient();

    await waitFor(() =>
      expect(screen.getByText('Alice sent you a friend request')).toBeInTheDocument(),
    );

    expect(screen.getByText('Bob accepted your friend request')).toBeInTheDocument();
    expect(screen.getByText('invited you to join a group')).toBeInTheDocument();
    expect(screen.getByText('New discussion in your group')).toBeInTheDocument();
    expect(screen.getByText('You have a new notification')).toBeInTheDocument();

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('falls back to a generic body when the sender name is missing', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        notifications: [
          { id: 'n1', type: 'FRIEND_REQUEST', payload: {}, readAt: null, createdAt: iso(0) },
          { id: 'n2', type: 'FRIEND_ACCEPTED', payload: {}, readAt: null, createdAt: iso(0) },
        ],
      },
    });

    renderClient();

    await waitFor(() =>
      expect(screen.getByText('sent you a friend request')).toBeInTheDocument(),
    );
    expect(screen.getByText('accepted your friend request')).toBeInTheDocument();
  });

  it('marks a friend request read, updates the row, and routes to friends', async () => {
    const dispatchSpy = jest.spyOn(globalThis.window, 'dispatchEvent');
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    renderClient();

    await waitFor(() =>
      expect(screen.getByText('Alice sent you a friend request')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /notification: alice/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { notificationId: 'n1' } }),
      );
      expect(mockPush).toHaveBeenCalledWith('/friends');
      expect(
        dispatchSpy.mock.calls.some(([event]) => (event as Event).type === 'notifications-cleared'),
      ).toBe(true);
    });

    expect(screen.getByRole('button', { name: /notification: alice/i })).toHaveAttribute(
      'data-read',
      'true',
    );
  });

  it('silently ignores a failed mark-read mutation but still navigates', async () => {
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    mockMutate.mockRejectedValueOnce(new Error('nope'));
    renderClient();

    await waitFor(() =>
      expect(screen.getByText('Alice sent you a friend request')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /notification: alice/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/friends'));
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('marks all notifications read and hides the action', async () => {
    const dispatchSpy = jest.spyOn(globalThis.window, 'dispatchEvent');
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    renderClient();

    await waitFor(() => expect(screen.getByRole('button', { name: /mark all read/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ mutation: expect.stringContaining('MarkAllNotificationsRead') }),
      );
      expect(
        dispatchSpy.mock.calls.some(([event]) => (event as Event).type === 'notifications-cleared'),
      ).toBe(true);
    });

    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument();
  });

  it('shows an error toast when mark all read fails', async () => {
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    mockMutate.mockRejectedValueOnce(new Error('nope'));
    renderClient();

    await waitFor(() => expect(screen.getByRole('button', { name: /mark all read/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Failed to mark all as read.', 'error');
    });
  });

  it('accepts a friend request, removes the row, and toasts success', async () => {
    const dispatchSpy = jest.spyOn(globalThis.window, 'dispatchEvent');
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    renderClient();

    await waitFor(() => expect(screen.getByText('Accept')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Accept'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { friendshipId: 'f1' } }),
      );
      expect(mockAddToast).toHaveBeenCalledWith('Friend request accepted!', 'success');
      expect(
        dispatchSpy.mock.calls.some(([event]) => (event as Event).type === 'notifications-cleared'),
      ).toBe(true);
    });

    expect(screen.queryByText('Alice sent you a friend request')).not.toBeInTheDocument();
  });

  it('reports a missing friendship id when accepting', async () => {
    mockQuery.mockResolvedValueOnce({
      data: { notifications: [{ ...baseNotification, payload: {} }] },
    });
    renderClient();

    await waitFor(() => expect(screen.getByText('Accept')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Accept'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Missing friend request ID.', 'error');
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows an error toast when accepting fails', async () => {
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    mockMutate.mockRejectedValueOnce(new Error('nope'));
    renderClient();

    await waitFor(() => expect(screen.getByText('Accept')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Accept'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Failed to accept friend request.', 'error');
    });
  });

  it('rejects a friend request, removes the row, and toasts', async () => {
    const dispatchSpy = jest.spyOn(globalThis.window, 'dispatchEvent');
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    renderClient();

    await waitFor(() => expect(screen.getByText('Decline')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Decline'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { friendshipId: 'f1' } }),
      );
      expect(mockAddToast).toHaveBeenCalledWith('Friend request declined.', 'info');
      expect(
        dispatchSpy.mock.calls.some(([event]) => (event as Event).type === 'notifications-cleared'),
      ).toBe(true);
    });

    expect(screen.queryByText('Alice sent you a friend request')).not.toBeInTheDocument();
  });

  it('reports a missing friendship id when declining', async () => {
    mockQuery.mockResolvedValueOnce({
      data: { notifications: [{ ...baseNotification, payload: { fromName: 'Alice' } }] },
    });
    renderClient();

    await waitFor(() => expect(screen.getByText('Decline')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Decline'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Missing friend request ID.', 'error');
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows an error toast when declining fails', async () => {
    mockQuery.mockResolvedValueOnce({ data: { notifications: [baseNotification] } });
    mockMutate.mockRejectedValueOnce(new Error('nope'));
    renderClient();

    await waitFor(() => expect(screen.getByText('Decline')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Decline'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('Failed to decline friend request.', 'error');
    });
  });
});
