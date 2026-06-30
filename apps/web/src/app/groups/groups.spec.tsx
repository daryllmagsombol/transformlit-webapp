import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockAuthState: Record<string, unknown> = {
  user: { id: '1', displayName: 'Test User', avatarUrl: null },
  token: 'test-token',
  isHydrated: true,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

const mockQuery = jest.fn();
const mockMutate = jest.fn();

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
    mutate: mockMutate,
  },
}));

const mockAddToast = jest.fn();

jest.mock('../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  GroupCard: ({ name, description, memberCount }: { name: string; description?: string; memberCount: number }) => (
    <div data-testid="group-card">
      <span>{name}</span>
      {description && <span>{description}</span>}
      <span>{memberCount} members</span>
    </div>
  ),
  CategoryChip: ({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) => (
    <button data-testid="category-chip" data-active={active} onClick={onClick}>{label}</button>
  ),
  FeaturedGroupCard: ({ name, description, memberCount }: { name: string; description?: string; memberCount: number }) => (
    <div data-testid="featured-group-card">
      <span>{name}</span>
      {description && <span>{description}</span>}
      <span>{memberCount} active</span>
    </div>
  ),
  CompactGroupCard: ({ name, description, onClick }: { name: string; description?: string; onClick?: () => void }) => (
    <div data-testid="compact-group-card" onClick={onClick}>
      <span>{name}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}));

jest.mock('../../lib/constants', () => ({
  GROUP_CATEGORIES: [
    { key: 'BIBLICAL_STUDIES', label: 'Biblical Studies', icon: 'menu_book' },
    { key: 'MODERN_FICTION', label: 'Modern Fiction', icon: 'auto_stories' },
    { key: 'HISTORICAL', label: 'Historical', icon: 'history_edu' },
  ],
}));

import GroupsClient from './groups-client';

describe('GroupsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockAuthState = {
      user: { id: '1', displayName: 'Test User', avatarUrl: null },
      token: 'test-token',
      isHydrated: true,
    };
  });

  describe('auth guard', () => {
    it('shows loading spinner when not hydrated', () => {
      mockAuthState = { user: null, token: 'test-token', isHydrated: false };
      render(<GroupsClient />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows loading spinner when no token', () => {
      mockAuthState = { user: null, token: null, isHydrated: true };
      render(<GroupsClient />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('redirects to login when no token and hydrated', () => {
      mockAuthState = { user: null, token: null, isHydrated: true };
      render(<GroupsClient />);
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  describe('loading state', () => {
    it('shows loading skeletons while fetching', () => {
      mockQuery.mockReturnValue(new Promise(() => {}));
      render(<GroupsClient />);
      expect(screen.getByText('Active Groups')).toBeInTheDocument();
      expect(screen.getByText('Discover Groups')).toBeInTheDocument();
      expect(screen.queryAllByTestId('group-card').length).toBe(0);
      expect(screen.queryAllByTestId('featured-group-card').length).toBe(0);
    });
  });

  describe('active groups section', () => {
    it('renders group cards with name, description, and member count', async () => {
      mockQuery
        .mockResolvedValueOnce({
          data: {
            myGroups: [
              { id: '1', name: 'Bible Study', slug: 'bible-study', description: 'Weekly study', coverImageUrl: null, memberCount: 12, category: 'BIBLICAL_STUDIES', featured: false, createdAt: '2025-01-01' },
              { id: '2', name: 'Fiction Lovers', slug: 'fiction-lovers', description: 'Read fiction together', coverImageUrl: null, memberCount: 8, category: 'MODERN_FICTION', featured: false, createdAt: '2025-01-01' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getByText('Bible Study')).toBeInTheDocument();
      });

      expect(screen.getByText('Fiction Lovers')).toBeInTheDocument();
    });

    it('shows empty message when no active groups', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getByText("You haven't joined any groups yet. Discover one below!")).toBeInTheDocument();
      });
    });
  });

  describe('discover groups section', () => {
    it('renders featured group card and compact group cards', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({
          data: {
            discoverGroups: [
              { id: '1', name: 'Featured Group', slug: 'featured', description: 'A featured group', coverImageUrl: null, memberCount: 50, category: 'BIBLICAL_STUDIES', featured: true, createdAt: '2025-01-01' },
              { id: '2', name: 'Side Group', slug: 'side', description: 'A side group', coverImageUrl: null, memberCount: 5, category: 'MODERN_FICTION', featured: false, createdAt: '2025-01-01' },
            ],
          },
        });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getByTestId('featured-group-card')).toBeInTheDocument();
      });

      expect(screen.getByText('Featured Group')).toBeInTheDocument();
      expect(screen.getByTestId('compact-group-card')).toBeInTheDocument();
      expect(screen.getByText('Side Group')).toBeInTheDocument();
    });

    it('shows empty message when no discoverable groups', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getByText('No discoverable groups found.')).toBeInTheDocument();
      });
    });

    it('shows category-specific empty message when filtered', async () => {
      mockAuthState = { user: null, token: 'test-token', isHydrated: true };
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      render(<GroupsClient />);

      await waitFor(() => {
        const chips = screen.getAllByTestId('category-chip');
        fireEvent.click(chips[0]);
      });

      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      await waitFor(() => {
        expect(screen.getByText('No discoverable groups found in this category.')).toBeInTheDocument();
      });
    });
  });

  describe('category filters', () => {
    it('renders category chips', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getAllByTestId('category-chip').length).toBe(3);
      });

      expect(screen.getByText('Biblical Studies')).toBeInTheDocument();
      expect(screen.getByText('Modern Fiction')).toBeInTheDocument();
      expect(screen.getByText('Historical')).toBeInTheDocument();
    });

    it('toggles category filter on chip click', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getAllByTestId('category-chip').length).toBe(3);
      });

      const chips = screen.getAllByTestId('category-chip');
      fireEvent.click(chips[0]);

      expect(chips[0]).toHaveAttribute('data-active', 'true');
    });
  });

  describe('join group action', () => {
    it('calls join mutation when compact group card is clicked', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({
          data: {
            discoverGroups: [
              { id: 'g1', name: 'Joinable', slug: 'joinable', description: 'Join this', coverImageUrl: null, memberCount: 10, category: 'BIBLICAL_STUDIES', featured: true, createdAt: '2025-01-01' },
              { id: 'g2', name: 'Side Joinable', slug: 'side-joinable', description: 'Side', coverImageUrl: null, memberCount: 3, category: 'HISTORICAL', featured: false, createdAt: '2025-01-01' },
            ],
          },
        });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getByText('Side Joinable')).toBeInTheDocument();
      });

      mockMutate.mockResolvedValueOnce({ data: { joinGroup: { id: 'g2', role: 'MEMBER', status: 'ACTIVE' } } });

      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({
          data: {
            discoverGroups: [
              { id: 'g1', name: 'Joinable', slug: 'joinable', description: 'Join this', coverImageUrl: null, memberCount: 10, category: 'BIBLICAL_STUDIES', featured: true, createdAt: '2025-01-01' },
              { id: 'g2', name: 'Side Joinable', slug: 'side-joinable', description: 'Side', coverImageUrl: null, memberCount: 3, category: 'HISTORICAL', featured: false, createdAt: '2025-01-01' },
            ],
          },
        });

      const compactCards = screen.getAllByTestId('compact-group-card');
      fireEvent.click(compactCards[0]);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            variables: { groupId: 'g2' },
          }),
        );
      });
    });

    it('shows error toast when join fails', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({
          data: {
            discoverGroups: [
              { id: 'g1', name: 'Featured', slug: 'featured', description: 'F', coverImageUrl: null, memberCount: 10, category: 'BIBLICAL_STUDIES', featured: true, createdAt: '2025-01-01' },
              { id: 'g2', name: 'Fail Join', slug: 'fail-join', description: 'F', coverImageUrl: null, memberCount: 3, category: 'HISTORICAL', featured: false, createdAt: '2025-01-01' },
            ],
          },
        });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getByText('Fail Join')).toBeInTheDocument();
      });

      mockMutate.mockRejectedValueOnce(new Error('Network error'));

      const compactCards = screen.getAllByTestId('compact-group-card');
      fireEvent.click(compactCards[0]);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Failed to join group. Please try again.', 'error');
      });
    });
  });

  describe('error handling', () => {
    it('shows error toast when data loading fails', async () => {
      mockQuery.mockRejectedValue(new Error('Network error'));

      render(<GroupsClient />);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Failed to load groups.', 'error');
      });
    });
  });

  describe('hero header', () => {
    it('renders the hero heading', async () => {
      mockQuery
        .mockResolvedValueOnce({ data: { myGroups: [] } })
        .mockResolvedValueOnce({ data: { discoverGroups: [] } });

      render(<GroupsClient />);

      await waitFor(() => {
        expect(screen.getByText('Your Reading Circles')).toBeInTheDocument();
      });
    });
  });
});
