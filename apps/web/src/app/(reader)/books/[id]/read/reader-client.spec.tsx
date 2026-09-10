import { render, screen } from '@testing-library/react';

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
    selector({ theme: 'paper', mode: 'paged', zoom: 1, lastPage: {}, setLastPage: jest.fn(), setTheme: jest.fn(), setMode: jest.fn(), setZoom: jest.fn() }),
}));

jest.mock('../../../../../lib/reader/api', () => ({
  openReadingSession: jest.fn().mockResolvedValue({ expiresInMs: 900000 }),
  pageFrameUrl: (bookId: string, page: number) => `http://api.test/books/${bookId}/pages/${page}/frame`,
  fetchPageText: jest.fn().mockResolvedValue({ items: [{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] }),
  fetchReadProgress: jest.fn().mockResolvedValue({ currentPage: 2 }),
  saveReaderProgress: jest.fn().mockResolvedValue(undefined),
}));

import { ReaderClient } from './reader-client';

describe('ReaderClient', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
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

  it('resumes from saved progress when the URL has no page', async () => {
    render(<ReaderClient bookId="book-1" />);
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('shows the access-denied state when the manifest query fails', async () => {
    mockQuery.mockRejectedValue(new Error('forbidden'));
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    expect(await screen.findByText(/do not have access|not available/i)).toBeInTheDocument();
  });
});
