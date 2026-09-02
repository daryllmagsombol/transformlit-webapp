import { render, screen, fireEvent } from '@testing-library/react';
import { ChatThread } from './chat-thread';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import * as chatQueries from '../../lib/chat-queries';

jest.mock('../../lib/chat-queries', () => ({
  fetchMessages: jest.fn(),
  sendChatMessage: jest.fn(),
  markConversationRead: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useParams: () => ({ id: 'c1' }),
}));

var mockAddToast = jest.fn();

jest.mock('../ui', () => ({
  UserAvatar: () => <div data-testid="avatar" />,
  LoadingSpinner: () => <div>Loading…</div>,
  useToast: () => ({ addToast: mockAddToast }),
}));

const msg = (id: string, senderId: string, body: string, createdAt = '2026-09-02T09:00:00Z') => ({
  id,
  conversationId: 'c1',
  senderId,
  body,
  createdAt,
});

beforeEach(() => {
  useChatStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u1' } as any, token: 't', isHydrated: true });
  mockAddToast.mockClear();
  useChatStore.getState().setConversations([
    { id: 'c1', type: 'DIRECT', updatedAt: '2026-09-02T10:00:00Z', otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null }, group: null, lastMessage: null, unreadCount: 0, myLastReadAt: '2026-09-02T08:00:00Z' },
  ]);
});

it('renders messages from the store', async () => {
  (chatQueries.fetchMessages as jest.Mock).mockResolvedValue({
    messages: [msg('m1', 'u1', 'Hello'), msg('m2', 'u2', 'Hi there')],
    hasMore: false,
  });
  render(<ChatThread conversationId="c1" />);
  expect(await screen.findByText('Hello')).toBeInTheDocument();
  expect(screen.getByText('Hi there')).toBeInTheDocument();
  expect(chatQueries.markConversationRead).toHaveBeenCalledWith('c1');
});

it('sends a message on Enter and reconciles the temp message', async () => {
  (chatQueries.fetchMessages as jest.Mock).mockResolvedValue({ messages: [], hasMore: false });
  (chatQueries.sendChatMessage as jest.Mock).mockResolvedValue(msg('m-server', 'u1', 'New message'));

  render(<ChatThread conversationId="c1" />);
  const composer = await screen.findByPlaceholderText('Type a message…');
  fireEvent.change(composer, { target: { value: 'New message' } });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

  expect(chatQueries.sendChatMessage).toHaveBeenCalledWith('c1', 'New message');
  // let the awaited sendChatMessage resolve so the temp message is reconciled
  await Promise.resolve();
  // temp removed, server message appended
  const list = useChatStore.getState().messagesByConversation.c1.map((m) => m.id);
  expect(list).toEqual(['m-server']);
});

it('renders the New divider when there are unread messages', async () => {
  useChatStore.getState().setConversations([
    { id: 'c1', type: 'DIRECT', updatedAt: '2026-09-02T10:00:00Z', otherUser: { id: 'u2', displayName: 'Bob', avatarUrl: null }, group: null, lastMessage: null, unreadCount: 2, myLastReadAt: '2026-09-02T08:00:00Z' },
  ]);
  (chatQueries.fetchMessages as jest.Mock).mockResolvedValue({
    messages: [msg('m1', 'u2', 'old', '2026-09-02T07:00:00Z'), msg('m2', 'u2', 'new', '2026-09-02T09:30:00Z')],
    hasMore: false,
  });
  render(<ChatThread conversationId="c1" />);
  expect(await screen.findByText('New')).toBeInTheDocument();
});