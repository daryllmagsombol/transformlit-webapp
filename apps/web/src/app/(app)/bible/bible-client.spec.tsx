import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BibleClient from './bible-client';
import * as booksHook from '../../../lib/hooks/use-bible-books';
import { useBibleStore } from '../../../store/bible-store';

jest.mock('../../../lib/bible/search/worker-factory', () => ({
  createSearchWorker: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/bible',
}));

jest.mock('../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../lib/hooks/use-bible-books', () => ({
  useBibleBooks: jest.fn(),
}));

describe('BibleClient', () => {
  beforeEach(() => {
    (booksHook.useBibleBooks as jest.Mock).mockReturnValue({
      books: [],
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
  });
});
