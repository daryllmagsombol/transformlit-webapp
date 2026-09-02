import { render } from '@testing-library/react';
import { ChatProvider } from './chat-provider';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import * as chatQueries from '../../lib/chat-queries';

jest.mock('../../lib/chat-queries', () => ({
  MESSAGE_ADDED: { kind: 'Document' },
  fetchConversations: jest.fn(),
}));

var mockSubscribe: jest.Mock;

jest.mock('../../lib/apollo-client', () => {
  mockSubscribe = jest.fn();
  return {
    apolloClient: { subscribe: mockSubscribe },
  };
});

describe('ChatProvider', () => {
  let unsub: () => void;

  beforeEach(() => {
    useChatStore.getState().reset();
    useAuthStore.setState({ user: { id: 'u1' } as any, token: 't', isHydrated: true });
    unsub = jest.fn();
    mockSubscribe.mockReset();
    mockSubscribe.mockReturnValue({
      subscribe: jest.fn(({ next }) => {
        next({ data: { messageAdded: { id: 'm1', conversationId: 'c1', senderId: 'u2', body: 'hi', createdAt: '2026-09-02T10:00:00Z' } } });
        return { unsubscribe: unsub };
      }),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('subscribes once per user and appends known-conversation messages', () => {
    useChatStore.getState().setConversations([
      { id: 'c1', type: 'DIRECT', updatedAt: '2026-09-02T10:00:00Z', otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null }, group: null, lastMessage: null, unreadCount: 0, myLastReadAt: null },
    ]);
    render(<ChatProvider />);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().messagesByConversation.c1).toHaveLength(1);
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(1);
  });

  it('refetches conversations for unknown conversations', async () => {
    (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([]);
    render(<ChatProvider />);
    await Promise.resolve();
    expect(chatQueries.fetchConversations).toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<ChatProvider />);
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});