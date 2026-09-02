import { useChatStore } from './chat-store';

const conv = (id: string, unread = 0, updatedAt = '2026-09-02T10:00:00Z') => ({
  id,
  type: 'DIRECT' as const,
  updatedAt,
  otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null },
  group: null,
  lastMessage: null,
  unreadCount: unread,
  myLastReadAt: null,
});

const msg = (id: string, conversationId: string) => ({
  id,
  conversationId,
  senderId: 'u2',
  body: 'hi',
  createdAt: '2026-09-02T10:00:00Z',
});

beforeEach(() => useChatStore.getState().reset());

describe('chat store', () => {
  it('computes totalUnread on setConversations', () => {
    useChatStore.getState().setConversations([conv('c1', 2), conv('c2', 1)]);
    expect(useChatStore.getState().totalUnread).toBe(3);
  });

  it('sorts conversations by updatedAt desc', () => {
    useChatStore.getState().setConversations([
      conv('old', 0, '2026-09-01T10:00:00Z'),
      conv('new', 0, '2026-09-03T10:00:00Z'),
    ]);
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('appendMessage dedupes by id', () => {
    useChatStore.getState().setConversations([conv('c1')]);
    useChatStore.getState().setMessages('c1', [msg('m1', 'c1')], false);
    useChatStore.getState().appendMessage(msg('m1', 'c1'));
    useChatStore.getState().appendMessage(msg('m2', 'c1'));
    expect(useChatStore.getState().messagesByConversation.c1.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('increments unread for a non-viewed conversation', () => {
    useChatStore.getState().setConversations([conv('c1', 0)]);
    useChatStore.getState().setViewingConversationId('c2');
    useChatStore.getState().appendMessage(msg('m1', 'c1'));
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(1);
    expect(useChatStore.getState().totalUnread).toBe(1);
  });

  it('does not increment unread for the viewed conversation', () => {
    useChatStore.getState().setConversations([conv('c1', 0)]);
    useChatStore.getState().setViewingConversationId('c1');
    useChatStore.getState().appendMessage(msg('m1', 'c1'));
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(0);
  });

  it('clearUnread zeroes one conversation and recomputes total', () => {
    useChatStore.getState().setConversations([conv('c1', 3), conv('c2', 2)]);
    useChatStore.getState().clearUnread('c1');
    expect(useChatStore.getState().conversations[0].unreadCount).toBe(0);
    expect(useChatStore.getState().totalUnread).toBe(2);
  });

  it('prependMessages keeps chronological order and pages', () => {
    useChatStore.getState().setMessages('c1', [msg('m3', 'c1'), msg('m4', 'c1')], false);
    useChatStore.getState().prependMessages('c1', [msg('m1', 'c1'), msg('m2', 'c1')], true, 'cursor-1');
    const ids = useChatStore.getState().messagesByConversation.c1.map((m) => m.id);
    expect(ids).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(useChatStore.getState().hasMoreByConversation.c1).toBe(true);
    expect(useChatStore.getState().cursorByConversation.c1).toBe('cursor-1');
  });
});