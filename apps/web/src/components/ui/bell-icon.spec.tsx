import { render, screen, waitFor, act } from '@testing-library/react';
import { BellIcon } from './bell-icon';

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    query: jest.fn(),
    subscribe: jest.fn(),
  },
}));

import { apolloClient } from '../../lib/apollo-client';

const mockQuery = apolloClient.query as jest.Mock;
const mockSubscribe = apolloClient.subscribe as jest.Mock;

interface SubscriptionMock {
  unsubscribe: jest.Mock;
  handlers: Record<string, () => void>;
}

/** Makes apolloClient.subscribe() return an observable that records the
 *  handlers and a disposable subscription, mirroring the real shape. */
function mockNotificationSubscription(): SubscriptionMock {
  const unsubscribe = jest.fn();
  const handlers: Record<string, () => void> = {};
  mockSubscribe.mockReturnValue({
    subscribe: jest.fn((h: Record<string, () => void>) => {
      Object.assign(handlers, h);
      return { unsubscribe };
    }),
  });
  return { unsubscribe, handlers };
}

describe('BellIcon', () => {
  const onClick = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    onClick.mockClear();
    mockQuery.mockResolvedValue({
      data: { unreadNotificationCount: 0 },
    });
  });

  it('subscribes once per userId and resubscribes only when the userId changes', async () => {
    const first = mockNotificationSubscription();

    const { rerender } = render(<BellIcon userId="user-1" onClick={onClick} />);
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { userId: 'user-1' } }),
    );

    // Unrelated re-render with the SAME userId must not resubscribe.
    rerender(<BellIcon userId="user-1" onClick={onClick} />);
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    expect(first.unsubscribe).not.toHaveBeenCalled();

    // Switching users tears down the old subscription and opens a new one.
    const second = mockNotificationSubscription();
    rerender(<BellIcon userId="user-2" onClick={onClick} />);
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(2));
    expect(mockSubscribe).toHaveBeenLastCalledWith(
      expect.objectContaining({ variables: { userId: 'user-2' } }),
    );
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(second.unsubscribe).not.toHaveBeenCalled();
  });

  it('unsubscribes when the component unmounts', async () => {
    const { unsubscribe } = mockNotificationSubscription();

    const { unmount } = render(<BellIcon userId="user-1" onClick={onClick} />);
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not resubscribe when an inbound notification re-renders the bell', async () => {
    const { unsubscribe, handlers } = mockNotificationSubscription();

    const { rerender } = render(<BellIcon userId="user-1" onClick={onClick} />);
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));

    // Simulate a pushed notification: increments the badge (setCount) and
    // triggers a re-render. Before the fix, this state change would have run
    // the effect cleanup and killed the subscription.
    act(() => {
      handlers.next?.();
    });
    expect(screen.getByText('1')).toBeInTheDocument();

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    expect(unsubscribe).not.toHaveBeenCalled();

    // Another plain re-render (new onClick identity, same userId).
    rerender(<BellIcon userId="user-1" onClick={() => {}} />);
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('does not subscribe when no userId is provided', async () => {
    render(<BellIcon userId="" onClick={onClick} />);
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1));
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
