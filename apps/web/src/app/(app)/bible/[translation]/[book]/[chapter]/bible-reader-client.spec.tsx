import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BibleReaderClient from './bible-reader-client';
import * as chapterHook from '../../../../../../lib/hooks/use-chapter';
import * as booksHook from '../../../../../../lib/hooks/use-bible-books';
import { ToastProvider } from '../../../../../../components/ui';
import type { BibleChapter, TranslationBook } from '../../../../../../lib/bible/types';

function renderWithProviders(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

jest.mock('../../../../../../lib/bible/search/worker-factory', () => ({
  createSearchWorker: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/bible/BSB/ROM/12',
}));

jest.mock('../../../../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../../../../lib/hooks/use-chapter', () => ({ useChapter: jest.fn() }));
jest.mock('../../../../../../lib/hooks/use-bible-books', () => ({ useBibleBooks: jest.fn() }));

const books: TranslationBook[] = [
  { id: 'ROM', name: 'Romans', commonName: 'Romans', title: null, order: 45, numberOfChapters: 16, firstChapterNumber: 1, lastChapterNumber: 16, totalNumberOfVerses: 433 },
];

const chapter: BibleChapter = {
  translation: { id: 'BSB', name: 'Berean Standard Bible', shortName: 'BSB' },
  book: books[0],
  thisChapterLink: '/api/BSB/ROM/12.json',
  nextChapterApiLink: '/api/BSB/ROM/13.json',
  previousChapterApiLink: '/api/BSB/ROM/11.json',
  numberOfVerses: 21,
  chapter: {
    number: 12,
    content: [
      { type: 'verse', number: 1, content: ['Therefore I urge you, brothers, by the mercies of God.'] },
    ],
    footnotes: [],
  },
};

describe('BibleReaderClient', () => {
  beforeEach(() => {
    (chapterHook.useChapter as jest.Mock).mockReturnValue({
      chapter,
      words: null,
      loading: false,
      error: null,
    });
    (booksHook.useBibleBooks as jest.Mock).mockReturnValue({
      books,
      loading: false,
      error: null,
      reload: jest.fn(),
    });
  });

  it('renders the toolbar and verse text', async () => {
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByText('Romans 12')).toBeInTheDocument());
    expect(screen.getByText(/Therefore I urge you/)).toBeInTheDocument();
  });

  it('opens the study sheet when a verse is tapped', async () => {
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Verse 1')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Verse 1'));
    expect(await screen.findByText('Romans 12:1')).toBeInTheDocument();
  });
});
