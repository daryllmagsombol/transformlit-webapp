import { render, screen, waitFor } from '@testing-library/react';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

let mockAuthState: Record<string, unknown> = {
  user: { id: '1', displayName: 'Test User', avatarUrl: null },
  token: 'test-token',
  isHydrated: true,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

const mockQuery = jest.fn();

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
  },
}));

const mockAddToast = jest.fn();

jest.mock('../../components/layout/sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

jest.mock('../../components/layout/topbar', () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

jest.mock('../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  NavItem: ({ label, href, active }: { label: string; href: string; active?: boolean }) => (
    <a href={href} data-active={active}>{label}</a>
  ),
  UserAvatar: ({ displayName }: { displayName?: string }) => (
    <span data-testid="user-avatar">{displayName}</span>
  ),
  SkeletonCard: ({ lines }: { lines?: number }) => (
    <div data-testid="skeleton-card" data-lines={lines} />
  ),
}));

jest.mock('../../lib/time-ago', () => ({
  timeAgo: () => '5 minutes ago',
}));

jest.mock('../../lib/constants', () => ({
  getCategoryConfig: (category?: string) => {
    const configs: Record<string, { icon: string; iconBg: string; label: string; badgeClass: string }> = {
      EVENT: { icon: 'event_available', iconBg: 'bg-secondary', label: 'Event', badgeClass: 'bg-event' },
      UPDATE: { icon: 'campaign', iconBg: 'bg-tertiary', label: 'Update', badgeClass: 'bg-update' },
      GENERAL: { icon: 'info', iconBg: 'bg-general', label: 'General', badgeClass: 'bg-general' },
    };
    return configs[category ?? ''] ?? configs.GENERAL;
  },
  getGroupMeta: (slug: string, fallbackTime: string) => ({
    activityText: (name: string, count: number) => `${count} members`,
    timeLabel: fallbackTime,
  }),
  QUICK_TRACK_CHAPTERS: ['Romans 12', 'Psalms 23'],
  BOTTOM_NAV_ITEMS: [
    { label: 'Feed', href: '/feed', icon: 'dynamic_feed' },
    { label: 'Friends', href: '/friends', icon: 'group' },
  ],
}));

import FeedClient from './feed-client';

describe('FeedClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockAuthState = {
      user: { id: '1', displayName: 'Test User', avatarUrl: null },
      token: 'test-token',
      isHydrated: true,
    };
  });

  describe('auth guard', () => {
    it('shows loading spinner when not hydrated', () => {
      mockAuthState = { user: null, token: 'test-token', isHydrated: false };
      render(<FeedClient />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('redirects to login when hydrated but no token instead of showing spinner', () => {
      mockAuthState = { user: null, token: null, isHydrated: true };
      render(<FeedClient />);
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  describe('loading state', () => {
    it('shows skeleton cards while loading', () => {
      mockQuery.mockReturnValue(new Promise(() => {}));
      render(<FeedClient />);
      const skeletons = screen.getAllByTestId('skeleton-card');
      expect(skeletons.length).toBe(2);
    });
  });

  describe('announcements list', () => {
    it('renders announcements with titles and category badges', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: {
            announcements: [
              { id: '1', title: 'Church Event', body: 'Join us Sunday', status: 'PUBLISHED', category: 'EVENT', publishedAt: '2025-01-01', createdAt: '2025-01-01' },
              { id: '2', title: 'Platform Update', body: 'New features', status: 'PUBLISHED', category: 'UPDATE', publishedAt: '2025-01-02', createdAt: '2025-01-02' },
            ],
            verseOfDay: null,
          },
        })
        .mockResolvedValueOnce({ data: { groups: [] } });

      render(<FeedClient />);

      await waitFor(() => {
        expect(screen.getByText('Church Event')).toBeInTheDocument();
      });

      expect(screen.getByText('Platform Update')).toBeInTheDocument();
      expect(screen.getByText('Event')).toBeInTheDocument();
      expect(screen.getByText('Update')).toBeInTheDocument();
    });

    it('renders announcement body text', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: {
            announcements: [
              { id: '1', title: 'Test Title', body: 'Test body content', status: 'PUBLISHED', category: 'GENERAL', publishedAt: '2025-01-01', createdAt: '2025-01-01' },
            ],
            verseOfDay: null,
          },
        })
        .mockResolvedValueOnce({ data: { groups: [] } });

      render(<FeedClient />);

      await waitFor(() => {
        expect(screen.getByText('Test body content')).toBeInTheDocument();
      });
    });
  });

  describe('Verse of the Day', () => {
    it('renders verse of the day section when available', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: {
            announcements: [],
            verseOfDay: { date: '2025-01-01', text: 'For God so loved the world', reference: 'John 3:16', version: 'NIV' },
          },
        })
        .mockResolvedValueOnce({ data: { groups: [] } });

      render(<FeedClient />);

      await waitFor(() => {
        expect(screen.getByText('Verse of the Day')).toBeInTheDocument();
      });

      expect(screen.getByText(/For God so loved the world/)).toBeInTheDocument();
      expect(screen.getByText(/John 3:16/)).toBeInTheDocument();
    });

    it('does not render verse section when no verse data', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: { announcements: [], verseOfDay: null },
        })
        .mockResolvedValueOnce({ data: { groups: [] } });

      render(<FeedClient />);

      await waitFor(() => {
        expect(screen.getByText('Announcements')).toBeInTheDocument();
      });

      expect(screen.queryByText('Verse of the Day')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no announcements', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: { announcements: [], verseOfDay: null },
        })
        .mockResolvedValueOnce({ data: { groups: [] } });

      render(<FeedClient />);

      await waitFor(() => {
        expect(screen.getByText('No announcements yet.')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error toast when data loading fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Network error'));

      render(<FeedClient />);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Failed to load feed. Please try again.', 'error');
      });
    });
  });

  describe('groups sidebar', () => {
    it('renders groups in sidebar', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: { announcements: [], verseOfDay: null },
        })
        .mockResolvedValueOnce({
          data: {
            groups: [
              { id: '1', name: 'Bible Study', slug: 'bible-study', description: 'Study group', memberCount: 10, visibility: 'PUBLIC', createdAt: '2025-01-01' },
            ],
          },
        });

      render(<FeedClient />);

      await waitFor(() => {
        expect(screen.getByText('Bible Study')).toBeInTheDocument();
      });
    });

    it('shows no groups message when groups list is empty', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: { announcements: [], verseOfDay: null },
        })
        .mockResolvedValueOnce({ data: { groups: [] } });

      render(<FeedClient />);

      await waitFor(() => {
        expect(screen.getByText('No groups yet.')).toBeInTheDocument();
      });
    });
  });
});
