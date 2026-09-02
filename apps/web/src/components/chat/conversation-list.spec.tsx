import { render, screen } from '@testing-library/react';
import { ConversationList } from './conversation-list';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import * as chatQueries from '../../lib/chat-queries';

jest.mock('../../lib/chat-queries', () => ({
  fetchConversations: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/chat',
  useRouter: () => ({ push: jest.fn() }),
}));

const conv = (id: string, unread = 0, name = 'Bob') => ({
  id,
  type: 'DIRECT' as const,
  updatedAt: '2026-09-02T10:00:00Z',
  otherUser: { id: 'u2', displayName: name, avatarUrl: null },
  group: null,
  lastMessage: { id: 'm1', body: 'Hello there', senderId: 'u2', createdAt: '2026-09-02T09:00:00Z' },
  unreadCount: unread,
  myLastReadAt: null,
});

beforeEach(() => {
  useChatStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u1' } as any, token: 't', isHydrated: true });
});

it('renders conversations with names, previews and unread chips', async () => {
  (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([
    conv('c1', 3),
    { ...conv('c2', 0, 'Alice'), lastMessage: { id: 'm2', body: 'See you soon', senderId: 'u2', createdAt: '2026-09-02T08:30:00Z' } },
  ]);
  render(<ConversationList />);
  expect(await screen.findByText('Bob')).toBeInTheDocument();
  expect(screen.getByText('Alice')).toBeInTheDocument();
  expect(screen.getByText('Hello there')).toBeInTheDocument();
  expect(screen.getByText('See you soon')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
});

it('renders the empty state', async () => {
  (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([]);
  render(<ConversationList />);
  expect(await screen.findByText(/No conversations yet/i)).toBeInTheDocument();
});

it('renders group conversations with group name', async () => {
  (chatQueries.fetchConversations as jest.Mock).mockResolvedValue([
    { ...conv('g1'), type: 'GROUP' as const, otherUser: null, group: { id: 'g1', name: 'Book Club', slug: 'book-club', coverImageUrl: null } },
  ]);
  render(<ConversationList />);
  expect(await screen.findByText('Book Club')).toBeInTheDocument();
});