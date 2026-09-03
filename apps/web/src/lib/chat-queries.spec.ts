jest.mock('./apollo-client', () => ({
  apolloClient: {
    query: jest.fn(),
  },
}));

import { apolloClient } from './apollo-client';
import { fetchMessages, type ChatMessage } from './chat-queries';

const mockQuery = apolloClient.query as jest.Mock;

const msg = (
  id: string,
  body: string,
  createdAt: string,
): { node: ChatMessage; cursor: string } => ({
  node: { id, conversationId: 'c1', senderId: 'u1', body, createdAt },
  cursor: `cursor-${id}`,
});

describe('fetchMessages', () => {
  it('returns messages in ASCENDING order when the API returns newest-first edges', async () => {
    mockQuery.mockResolvedValue({
      data: {
        messages: {
          edges: [
            msg('m3', 'newest', '2026-09-02T12:00:00Z'),
            msg('m2', 'middle', '2026-09-02T11:00:00Z'),
            msg('m1', 'oldest', '2026-09-02T10:00:00Z'),
          ],
          hasNextPage: true,
        },
      },
    });

    const { messages } = await fetchMessages('c1');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(messages.map((m) => m.body)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('returns cursor = the last (oldest) edge cursor for loading older messages', async () => {
    mockQuery.mockResolvedValue({
      data: {
        messages: {
          edges: [
            msg('m3', 'newest', '2026-09-02T12:00:00Z'),
            msg('m2', 'middle', '2026-09-02T11:00:00Z'),
            msg('m1', 'oldest', '2026-09-02T10:00:00Z'),
          ],
          hasNextPage: true,
        },
      },
    });

    const { cursor } = await fetchMessages('c1');
    expect(cursor).toBe('cursor-m1');
  });

  it('returns hasMore from hasNextPage', async () => {
    mockQuery.mockResolvedValue({
      data: {
        messages: {
          edges: [msg('m1', 'only', '2026-09-02T10:00:00Z')],
          hasNextPage: false,
        },
      },
    });

    const { hasMore } = await fetchMessages('c1');
    expect(hasMore).toBe(false);
  });

  it('passes the cursor and limit through to the query', async () => {
    mockQuery.mockResolvedValue({
      data: {
        messages: {
          edges: [msg('m1', 'only', '2026-09-02T10:00:00Z')],
          hasNextPage: false,
        },
      },
    });

    await fetchMessages('c1', 'cursor-m2', 50);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { conversationId: 'c1', cursor: 'cursor-m2', limit: 50 },
      }),
    );
  });
});