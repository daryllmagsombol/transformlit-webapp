import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockQuery = jest.fn();
const mockMutate = jest.fn();

let mockAuthState: Record<string, unknown> = {
  user: { id: 'u1', displayName: 'Test User', avatarUrl: null },
  isHydrated: true,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: { query: mockQuery, mutate: mockMutate },
}));

const mockAddToast = jest.fn();

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading…</div>,
}));

import { GroupHighlights } from './group-highlights';

function share(id: string, sharedById = 'u2') {
  return {
    id,
    groupId: 'g1',
    createdAt: '2025-01-01T00:00:00Z',
    sharedBy: { id: sharedById, displayName: `User ${sharedById}`, avatarUrl: null },
    highlight: {
      id: `hl-${id}`,
      bookId: 'b1',
      bookTitle: 'Usbong',
      page: 12,
      text: `quote ${id}`,
      note: null,
      color: 'yellow',
    },
  };
}

describe('GroupHighlights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = {
      user: { id: 'u1', displayName: 'Test User', avatarUrl: null },
      isHydrated: true,
    };
  });

  it('shows an empty state when there are no shares', async () => {
    mockQuery.mockResolvedValue({ data: { groupHighlights: [] } });
    render(<GroupHighlights groupId="g1" canModerate={false} />);
    expect(await screen.findByText('No shared highlights yet.')).toBeInTheDocument();
  });

  it('renders each share with book, page, quote, and sharer', async () => {
    mockQuery.mockResolvedValue({ data: { groupHighlights: [share('s1')] } });
    render(<GroupHighlights groupId="g1" canModerate={false} />);
    expect(await screen.findByText('quote s1')).toBeInTheDocument();
    expect(screen.getByText(/Usbong · page 12/)).toBeInTheDocument();
    expect(screen.getByText('User u2')).toBeInTheDocument();
  });

  it('degrades to a neutral state when the query fails', async () => {
    mockQuery.mockRejectedValue(new Error('offline'));
    render(<GroupHighlights groupId="g1" canModerate={false} />);
    expect(await screen.findByText(/unavailable right now/)).toBeInTheDocument();
  });

  it('offers unshare only on the caller\'s own shares', async () => {
    mockQuery.mockResolvedValue({ data: { groupHighlights: [share('s1', 'u2'), share('s2', 'u1')] } });
    render(<GroupHighlights groupId="g1" canModerate={false} />);
    await screen.findByText('quote s1');
    expect(screen.getAllByText('Unshare')).toHaveLength(1);
  });

  it('lets a moderator unshare another member\'s share', async () => {
    mockQuery.mockResolvedValue({ data: { groupHighlights: [share('s1', 'u2')] } });
    render(<GroupHighlights groupId="g1" canModerate />);
    await screen.findByText('quote s1');
    expect(screen.getByText('Unshare')).toBeInTheDocument();
  });

  it('removes a share after a successful unshare', async () => {
    mockQuery.mockResolvedValue({ data: { groupHighlights: [share('s1', 'u1')] } });
    mockMutate.mockResolvedValue({ data: { unshareHighlight: true } });
    render(<GroupHighlights groupId="g1" canModerate={false} />);
    await screen.findByText('quote s1');
    fireEvent.click(screen.getByText('Unshare'));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      variables: { shareId: 's1' },
    })));
    await waitFor(() => expect(screen.queryByText('quote s1')).not.toBeInTheDocument());
  });

  it('keeps the share and toasts when unshare fails', async () => {
    mockQuery.mockResolvedValue({ data: { groupHighlights: [share('s1', 'u1')] } });
    mockMutate.mockRejectedValue(new Error('offline'));
    render(<GroupHighlights groupId="g1" canModerate={false} />);
    await screen.findByText('quote s1');
    fireEvent.click(screen.getByText('Unshare'));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Failed to unshare highlight.', 'error'));
    expect(screen.getByText('quote s1')).toBeInTheDocument();
  });

  it('loads more when a full page is returned', async () => {
    const fullPage = Array.from({ length: 25 }, (_, i) => share(`s${i}`));
    mockQuery.mockResolvedValueOnce({ data: { groupHighlights: fullPage } });
    render(<GroupHighlights groupId="g1" canModerate={false} />);
    await screen.findByText('quote s0');
    mockQuery.mockResolvedValueOnce({ data: { groupHighlights: [share('s99')] } });
    fireEvent.click(screen.getByText('Load more'));
    expect(await screen.findByText('quote s99')).toBeInTheDocument();
  });
});
