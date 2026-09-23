import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/books',
}));

let mockAuthState: Record<string, unknown> = {
  user: { id: '1', displayName: 'Test User', avatarUrl: null },
  isHydrated: true,
};

jest.mock('../../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

const mockQuery = jest.fn();

jest.mock('../../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
  },
}));

const mockAddToast = jest.fn();

jest.mock('../../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  NavItem: ({ label, href, active }: { label: string; href: string; active?: boolean }) => (
    <a href={href} data-active={active}>{label}</a>
  ),
  BookCard: ({ book, onRead, onBuy }: { book: { id: string; title: string; author?: string; accessLevel: string; coverUrl?: string }; onRead?: () => void; onBuy?: () => void }) => (
    <div data-testid="book-card" data-book-id={book.id}>
      <span>{book.title}</span>
      {book.author && <span>{book.author}</span>}
      <span data-testid="access-badge">{book.accessLevel === 'FREE' ? 'Community' : 'Premium'}</span>
      {book.accessLevel === 'FREE' ? (
        <button data-testid="read-btn" onClick={onRead}>Read</button>
      ) : (
        <button data-testid="buy-btn" onClick={onBuy}>Buy</button>
      )}
    </div>
  ),
  BookCardSkeleton: () => (
    <div data-testid="book-card-skeleton" />
  ),
  ReadingProgressCard: ({ title, author, currentPage, totalPages, onContinue }: { title: string; author?: string; currentPage: number; totalPages: number; onContinue?: () => void }) => (
    <div data-testid="reading-progress-card">
      <span>{title}</span>
      {author && <span>{author}</span>}
      <span data-testid="progress">{currentPage} / {totalPages}</span>
      <button data-testid="continue-btn" onClick={onContinue}>Continue</button>
    </div>
  ),
  LoadingSpinner: ({ showLabel = true }: { showLabel?: boolean }) => (
    <div data-testid="loading-spinner">{showLabel && 'Loading…'}</div>
  ),
}));

// BOTTOM_NAV_ITEMS mock removed — now in shared BottomNav (AppShell)

import BooksClient from './books-client';

describe('BooksClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockAuthState = {
      user: { id: '1', displayName: 'Test User', avatarUrl: null },
      isHydrated: true,
    };
  });

  describe('auth guard', () => {
    it('shows loading spinner when not hydrated', () => {
      mockAuthState = { user: { id: '1' }, isHydrated: false };
      render(<BooksClient />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows loading spinner when no user is signed in', () => {
      mockAuthState = { user: null, isHydrated: true };
      render(<BooksClient />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('redirects to login when no user is signed in and hydrated', () => {
      mockAuthState = { user: null, isHydrated: true };
      render(<BooksClient />);
      expect(mockPush).toHaveBeenCalledWith('/login?redirect=%2Fbooks');
    });
  });

  describe('loading state', () => {
    it('shows book card skeletons while loading', () => {
      mockQuery.mockReturnValue(new Promise(() => {}));
      render(<BooksClient />);
      const skeletons = screen.getAllByTestId('book-card-skeleton');
      expect(skeletons.length).toBe(10);
    });
  });

  describe('currently reading section', () => {
    it('renders reading progress cards', async () => {
      mockQuery.mockResolvedValueOnce({ data: { books: [] } });
      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Currently Reading' })).toBeInTheDocument();
      });

      const cards = screen.getAllByTestId('reading-progress-card');
      expect(cards.length).toBe(2);
    });

    it('displays book title and author in progress cards', async () => {
      mockQuery.mockResolvedValueOnce({ data: { books: [] } });
      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('The Architect of Thought')).toBeInTheDocument();
      });

      expect(screen.getByText('Elena Voss')).toBeInTheDocument();
      expect(screen.getByText('Quiet Echoes')).toBeInTheDocument();
      expect(screen.getByText('Samuel Reed')).toBeInTheDocument();
    });

    it('displays reading progress', async () => {
      mockQuery.mockResolvedValueOnce({ data: { books: [] } });
      render(<BooksClient />);

      await waitFor(() => {
        const progressElements = screen.getAllByTestId('progress');
        expect(progressElements.length).toBe(2);
        expect(progressElements[0]).toHaveTextContent('212 / 340');
        expect(progressElements[1]).toHaveTextContent('18 / 150');
      });
    });
  });

  describe('browse books section', () => {
    it('renders book cards with title and author', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'The Great Journey', author: 'Jane Smith', description: 'A story', coverUrl: 'https://example.com/cover.jpg', price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 300, createdAt: '2025-01-01' },
            { id: '2', title: 'Premium Tales', author: 'John Doe', description: 'Premium', coverUrl: 'https://example.com/cover2.jpg', price: 9.99, currency: '$', accessLevel: 'PREMIUM', status: 'PUBLISHED', totalPages: 200, createdAt: '2025-02-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('The Great Journey')).toBeInTheDocument();
      });

      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('Premium Tales')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('renders access badges correctly', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Free Book', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
            { id: '2', title: 'Paid Book', author: 'Author', description: null, coverUrl: null, price: 5.99, currency: '$', accessLevel: 'PREMIUM', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        const badges = screen.getAllByTestId('access-badge');
        expect(badges.length).toBe(2);
        expect(badges[0]).toHaveTextContent('Community');
        expect(badges[1]).toHaveTextContent('Premium');
      });
    });

    it('shows read button for free books and buy button for premium', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Free Book', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
            { id: '2', title: 'Paid Book', author: 'Author', description: null, coverUrl: null, price: 5.99, currency: '$', accessLevel: 'PREMIUM', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByTestId('read-btn')).toBeInTheDocument();
        expect(screen.getByTestId('buy-btn')).toBeInTheDocument();
      });
    });

    it('shows book count in header', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Book One', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
            { id: '2', title: 'Book Two', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('View Library Stats →')).toBeInTheDocument();
      });
    });
  });

  describe('filter chips', () => {
    it('renders filter chips', async () => {
      mockQuery.mockResolvedValueOnce({ data: { books: [] } });
      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('All Books')).toBeInTheDocument();
        expect(screen.getByText('Community')).toBeInTheDocument();
        expect(screen.getByText('Premium')).toBeInTheDocument();
      });
    });

    it('filters books by FREE access level', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Free Book', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
            { id: '2', title: 'Paid Book', author: 'Author', description: null, coverUrl: null, price: 5.99, currency: '$', accessLevel: 'PREMIUM', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('Free Book')).toBeInTheDocument();
      });

      const communityChip = screen.getAllByRole('button', { name: 'Community' })[0];
      fireEvent.click(communityChip);

      await waitFor(() => {
        expect(screen.getByText('Free Book')).toBeInTheDocument();
        expect(screen.queryByText('Paid Book')).not.toBeInTheDocument();
      });
    });

    it('filters books by PREMIUM access level', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Free Book', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
            { id: '2', title: 'Paid Book', author: 'Author', description: null, coverUrl: null, price: 5.99, currency: '$', accessLevel: 'PREMIUM', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('Free Book')).toBeInTheDocument();
      });

      const premiumChip = screen.getAllByRole('button', { name: 'Premium' })[0];
      fireEvent.click(premiumChip);

      await waitFor(() => {
        expect(screen.queryByText('Free Book')).not.toBeInTheDocument();
        expect(screen.getByText('Paid Book')).toBeInTheDocument();
      });
    });
  });

  describe('sort dropdown', () => {
    it('renders sort dropdown with options', async () => {
      mockQuery.mockResolvedValueOnce({ data: { books: [] } });
      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByLabelText('Sort books')).toBeInTheDocument();
      });

      const select = screen.getByLabelText('Sort books');
      expect(select).toHaveValue('NEWEST');

      const options = screen.getAllByRole('option');
      expect(options.length).toBe(3);
    });

    it('sorts books by title when selected', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Zebra Tales', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
            { id: '2', title: 'Alpha Stories', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('Zebra Tales')).toBeInTheDocument();
      });

      const select = screen.getByLabelText('Sort books');
      fireEvent.change(select, { target: { value: 'TITLE' } });

      const bookCards = screen.getAllByTestId('book-card');
      expect(bookCards[0]).toHaveTextContent('Alpha Stories');
      expect(bookCards[1]).toHaveTextContent('Zebra Tales');
    });
  });

  describe('empty state', () => {
    it('shows empty state when no books', async () => {
      mockQuery.mockResolvedValueOnce({ data: { books: [] } });
      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('No books found')).toBeInTheDocument();
      });

      expect(screen.getByText('The library is empty right now. Check back soon for new titles.')).toBeInTheDocument();
    });

    it('shows filter-specific empty message', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Free Book', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('Free Book')).toBeInTheDocument();
      });

      const premiumChip = screen.getAllByRole('button', { name: 'Premium' })[0];
      fireEvent.click(premiumChip);

      await waitFor(() => {
        expect(screen.getByText('No books found')).toBeInTheDocument();
        expect(screen.getByText('No books match the selected filter. Try another category.')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error toast when data loading fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Network error'));

      render(<BooksClient />);

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('Failed to load books. Please try again.', 'error');
      });
    });
  });

  describe('read and buy actions', () => {
    it('shows info toast when read button is clicked', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Free Book', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByTestId('read-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('read-btn'));

      expect(mockAddToast).toHaveBeenCalledWith('Reader opening soon.', 'info');
    });

    it('shows info toast when buy button is clicked', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Paid Book', author: 'Author', description: null, coverUrl: null, price: 9.99, currency: '$', accessLevel: 'PREMIUM', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByTestId('buy-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('buy-btn'));

      expect(mockAddToast).toHaveBeenCalledWith('Paid books coming soon.', 'info');
    });
  });

  describe('discover more button', () => {
    it('shows discover more button when books are loaded', async () => {
      mockQuery.mockResolvedValueOnce({
        data: {
          books: [
            { id: '1', title: 'Book One', author: 'Author', description: null, coverUrl: null, price: null, currency: null, accessLevel: 'FREE', status: 'PUBLISHED', totalPages: 100, createdAt: '2025-01-01' },
          ],
        },
      });

      render(<BooksClient />);

      await waitFor(() => {
        expect(screen.getByText('Discover More Books')).toBeInTheDocument();
      });
    });
  });

  // bottom navigation moved to shared BottomNav (AppShell)
});
