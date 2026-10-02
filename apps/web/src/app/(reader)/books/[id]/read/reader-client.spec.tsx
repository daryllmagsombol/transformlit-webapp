import { render, screen, fireEvent } from '@testing-library/react';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/books/book-1/read',
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@apollo/client', () => ({ gql: (strings: TemplateStringsArray) => strings[0] }));

const mockQuery = jest.fn();
jest.mock('../../../../../lib/apollo-client', () => ({ apolloClient: { query: mockQuery } }));

jest.mock('../../../../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ user: { id: '1' }, isHydrated: true }),
  useReaderStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'paper', mode: 'paged', zoom: 1, setTheme: jest.fn(), setMode: jest.fn(), setZoom: jest.fn() }),
}));

const mockOpenSession = jest.fn().mockResolvedValue({ expiresInMs: 900000 });
const mockFetchText = jest.fn().mockResolvedValue({ items: [{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] });

jest.mock('../../../../../lib/reader/api', () => ({
  openReadingSession: (...args: unknown[]) => mockOpenSession(...args),
  pageFrameUrl: (bookId: string, page: number) => `http://api.test/books/${bookId}/pages/${page}/frame`,
  fetchPageText: (...args: unknown[]) => mockFetchText(...args),
  fetchReadProgress: jest.fn().mockResolvedValue({ currentPage: 2, revision: 1 }),
  networkReaderTransport: {
    openSession: (...args: unknown[]) => mockOpenSession(...args),
    fetchText: (...args: unknown[]) => mockFetchText(...args),
    frameUrl: (bookId: string, page: number) => `http://api.test/books/${bookId}/pages/${page}/frame`,
  },
}));

jest.mock('../../../../../lib/offline/database', () => ({ OfflineDatabase: jest.fn() }));
jest.mock('../../../../../lib/offline/account-activation', () => ({ accountLifecycle: () => ({ getOwner: () => null }) }));

const mockSaveProgress = jest.fn().mockResolvedValue({ status: 'SAVED', operationId: 'op-1', error: null });
const mockGetProgress = jest.fn().mockResolvedValue(null);
jest.mock('../../../../../lib/hooks/use-reader-records', () => ({
  readerRecords: () => ({
    saveProgress: (...args: unknown[]) => mockSaveProgress(...args),
    getProgress: (...args: unknown[]) => mockGetProgress(...args),
    createHighlight: jest.fn(),
    updateHighlight: jest.fn(),
    deleteHighlight: jest.fn(),
    addBookmark: jest.fn(),
    removeBookmark: jest.fn(),
    listHighlights: jest.fn().mockResolvedValue([]),
    listBookmarks: jest.fn().mockResolvedValue([]),
  }),
  useReaderAnnotations: () => ({ highlights: [], bookmarks: [], refresh: jest.fn() }),
}));

import { ReaderClient } from './reader-client';

const fetchPageTextMock = mockFetchText;
const openReadingSessionMock = mockOpenSession;

describe('ReaderClient', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    fetchPageTextMock.mockReset();
    fetchPageTextMock.mockResolvedValue({ items: [{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] });
    openReadingSessionMock.mockReset();
    openReadingSessionMock.mockResolvedValue({ expiresInMs: 900000 });
    mockSaveProgress.mockClear();
    mockGetProgress.mockReset();
    mockGetProgress.mockResolvedValue(null);
    mockQuery.mockResolvedValue({
      data: { book: { id: 'book-1', title: 'Test Book', format: 'PDF', pageCount: 3, conversionStatus: 'READY', toc: [] } },
    });
  });

  it('loads the manifest and renders the first frame', async () => {
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    expect(await screen.findByText('Test Book')).toBeInTheDocument();
    const frame = await screen.findByTestId('page-frame');
    expect(frame).toHaveAttribute('src', 'http://api.test/books/book-1/pages/1/frame');
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('clamps a deep-linked page that exceeds the page count', async () => {
    render(<ReaderClient bookId="book-1" initialPage={999} />);
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
  });

  it('retries page text once after refreshing the session on a 401', async () => {
    fetchPageTextMock
      .mockRejectedValueOnce(new Error('Reader request failed with 401'))
      .mockResolvedValueOnce({ items: [{ t: 'Recovered', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] });
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(openReadingSessionMock).toHaveBeenCalledTimes(2);
  });

  it('resumes from saved progress when the URL has no page', async () => {
    render(<ReaderClient bookId="book-1" />);
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('prefers the durable on-device progress over the server read', async () => {
    mockGetProgress.mockResolvedValue({ currentPage: 3 });
    render(<ReaderClient bookId="book-1" />);
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
  });

  it('persists progress locally on a deliberate page change only', async () => {
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    await screen.findByText('Page 1 of 3');
    expect(mockSaveProgress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(mockSaveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 'book-1', currentPage: 2 }),
    );
  });

  it('shows the access-denied state when the manifest query fails', async () => {
    mockQuery.mockRejectedValue(new Error('forbidden'));
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    expect(await screen.findByText(/do not have access|not available/i)).toBeInTheDocument();
  });

  it('shows a non-blocking fallback (not an infinite spinner) when the first page fails to open', async () => {
    fetchPageTextMock.mockRejectedValue(new Error('Request failed with 500'));
    render(<ReaderClient bookId="book-1" initialPage={1} />);

    // The metadata still loads, so the reader shell must not hang on a spinner.
    expect(await screen.findByText('Test Book')).toBeInTheDocument();
    expect(await screen.findByTestId('reader-page-error')).toBeInTheDocument();
    expect(screen.queryByTestId('page-frame')).not.toBeInTheDocument();
  });

  it('clears the stale page and shows a fallback when a page change fails to open', async () => {
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    const firstFrame = await screen.findByTestId('page-frame');
    expect(firstFrame).toHaveAttribute('src', 'http://api.test/books/book-1/pages/1/frame');

    // The next page fails to open; the previous page's raster must not linger.
    fetchPageTextMock.mockRejectedValue(new Error('Request failed with 500'));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByTestId('reader-page-error')).toBeInTheDocument();
    expect(screen.queryByTestId('page-frame')).not.toBeInTheDocument();
    // Never the stale page 1 raster at the new page position.
    expect(screen.queryByText('Page 1 of 3')).not.toBeInTheDocument();
  });
});
