import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BibleReaderClient from './bible-reader-client';
import * as chapterHook from '../../../../../../lib/hooks/use-chapter';
import * as booksHook from '../../../../../../lib/hooks/use-bible-books';
import { ToastProvider } from '../../../../../../components/ui';
import type { BibleChapter, ChapterWords, TranslationBook } from '../../../../../../lib/bible/types';

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

const baseChapter: BibleChapter = {
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

function mockHooks(overrides: {
  chapter?: BibleChapter;
  words?: ChapterWords | null;
  error?: string | null;
  books?: TranslationBook[];
} = {}) {
  (chapterHook.useChapter as jest.Mock).mockReturnValue({
    chapter: overrides.chapter ?? baseChapter,
    words: overrides.words ?? null,
    loading: false,
    error: overrides.error ?? null,
  });
  (booksHook.useBibleBooks as jest.Mock).mockReturnValue({
    books: overrides.books ?? books,
    loading: false,
    error: null,
    reload: jest.fn(),
  });
}

describe('BibleReaderClient', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    mockHooks();
    window.location.hash = '';
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

  it('shows a loading spinner until auth and data are ready', async () => {
    (chapterHook.useChapter as jest.Mock).mockReturnValue({
      chapter: null,
      words: null,
      loading: true,
      error: null,
    });
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders a failure message on error', async () => {
    mockHooks({ error: 'Failed to load chapter.' });
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByText('Failed to load this chapter.')).toBeInTheDocument());
  });

  it('renders chapter navigation links', async () => {
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByText('‹ Romans 11')).toBeInTheDocument());
    expect(screen.getByText('Romans 13 ›')).toBeInTheDocument();
  });

  it('opens the book-chapter picker', async () => {
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Choose book and chapter')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Choose book and chapter'));
    expect(screen.getByText('Choose a Chapter')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '13' })).toHaveAttribute('href', '/bible/BSB/ROM/13');
  });

  it('renders the audio player when chapter audio exists', async () => {
    mockHooks({
      chapter: {
        ...baseChapter,
        thisChapterAudioLinks: { gilbert: 'https://x/g.mp3' },
      },
    });
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument());
  });

  it('highlights the deep-linked verse from the hash', async () => {
    window.location.hash = '#v1';
    const { container } = renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(container.querySelector('#v1')?.className).toContain('border-primary'));
  });

  it('shows word study details when a tappable word is clicked', async () => {
    const withWords: BibleChapter = {
      ...baseChapter,
      chapter: {
        number: 12,
        content: [
          { type: 'verse', number: 1, content: ['Therefore I urge you, brothers.'] },
        ],
        footnotes: [],
      },
    };
    mockHooks({
      chapter: withWords,
      words: {
        verses: {
          '1': [{ contentIndex: 0, start: 12, end: 16, strongs: ['G3870'], lemma: 'παρακαλέω', morph: 'V-PPA' }],
        },
      },
    });
    renderWithProviders(<BibleReaderClient translation="ENGWEBP" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByText('urge')).toBeInTheDocument());
    fireEvent.click(screen.getByText('urge'));
    expect(await screen.findByText('Lemma')).toBeInTheDocument();
    expect(screen.getByText('G3870')).toBeInTheDocument();
  });

  it('opens the study sheet with footnote text when a marker is tapped', async () => {
    const withFootnotes: BibleChapter = {
      ...baseChapter,
      chapter: {
        number: 12,
        content: [
          { type: 'verse', number: 1, content: ['Therefore', { noteId: 0 }, ' I urge you.'] },
        ],
        footnotes: [{ noteId: 0, text: 'Cited in Romans 6:13', caller: 'a' }],
      },
    };
    mockHooks({ chapter: withFootnotes });
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Footnote 0')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Footnote 0'));
    expect(await screen.findAllByText('Cited in Romans 6:13')).not.toHaveLength(0);
  });
});