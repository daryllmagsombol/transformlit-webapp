import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BibleClient from './bible-client';
import * as booksHook from '../../../lib/hooks/use-bible-books';
import { useBibleStore } from '../../../store/bible-store';
import type { TranslationBook } from '../../../lib/bible/types';

jest.mock('../../../lib/bible/search/worker-factory', () => ({
  createSearchWorker: jest.fn(),
}));

let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/bible',
}));

jest.mock('../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../lib/hooks/use-bible-books', () => ({
  useBibleBooks: jest.fn(),
}));

const books: TranslationBook[] = [
  { id: 'GEN', name: 'Genesis', commonName: 'Genesis', title: null, order: 1, numberOfChapters: 50, firstChapterNumber: 1, lastChapterNumber: 50, totalNumberOfVerses: 1533 },
  { id: 'MAT', name: 'Matthew', commonName: 'Matthew', title: null, order: 40, numberOfChapters: 28, firstChapterNumber: 1, lastChapterNumber: 28, totalNumberOfVerses: 1071 },
];

describe('BibleClient', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    (booksHook.useBibleBooks as jest.Mock).mockReturnValue({
      books,
      loading: false,
      error: null,
      reload: jest.fn(),
    });
    useBibleStore.setState({
      translation: 'BSB',
      lastPosition: { BSB: { book: 'ROM', chapter: 8 } },
      indexStatus: {},
      isHydrated: true,
    });
  });

  it('renders the header, continue reading, quick tracks, and browse', async () => {
    render(<BibleClient />);
    await waitFor(() => expect(screen.getByText('Bible')).toBeInTheDocument());
    expect(screen.getByText('Continue reading')).toBeInTheDocument();
    expect(screen.getByText('Romans 8')).toBeInTheDocument();
    expect(screen.getByText('Romans 12')).toBeInTheDocument();
  });

  it('renders the translation chip with the curated label', async () => {
    render(<BibleClient />);
    await waitFor(() => expect(screen.getByText(/BSB · Berean Standard Bible/)).toBeInTheDocument());
  });

  it('opens the translation picker from the chip', async () => {
    render(<BibleClient />);
    await waitFor(() => expect(screen.getByText(/BSB · Berean Standard Bible/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/BSB · Berean Standard Bible/));
    expect(screen.getByText('Choose Translation')).toBeInTheDocument();
    expect(screen.getByText('Banal na Bibliya')).toBeInTheDocument();
  });

  it('applies the ?translation= param case-insensitively', async () => {
    searchParams = new URLSearchParams('translation=ENG_KJV');
    render(<BibleClient />);
    await waitFor(() => expect(screen.getByText(/eng_kjv · King James Version/)).toBeInTheDocument());
    expect(useBibleStore.getState().translation).toBe('eng_kjv');
  });

  it('shows the search panel in search mode', async () => {
    searchParams = new URLSearchParams('view=search');
    render(<BibleClient />);
    await waitFor(() => expect(screen.getByLabelText('Search the Bible')).toBeInTheDocument());
  });

  it('toggles between browse and search modes', async () => {
    render(<BibleClient />);
    await waitFor(() => expect(screen.getByText('Browse')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByLabelText('Search the Bible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    await waitFor(() => expect(screen.getByRole('link', { name: /Genesis/ })).toBeInTheDocument());
  });
});