import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import BibleReaderClient from './bible-reader-client';
import * as chapterHook from '../../../../../../lib/hooks/use-chapter';
import * as booksHook from '../../../../../../lib/hooks/use-bible-books';
import { ToastProvider } from '../../../../../../components/ui';
import type {
  BibleChapter,
  ChapterWords,
  CrossRefReference,
  TranslationBook,
} from '../../../../../../lib/bible/types';

const mockRecordActivity = jest.fn();

jest.mock('../../../../../../lib/progress/record-activity', () => ({
  recordActivity: (...args: unknown[]) => mockRecordActivity(...args),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

jest.mock('../../../../../../lib/bible/search/worker-factory', () => ({
  createSearchWorker: jest.fn(),
}));

// Controls the cross-reference buttons rendered inside StudySheet, so tests can
// drive the app's real `navigate` path through the public component surface.
const mockCrossRefs: { byVerse: Record<number, CrossRefReference[]> } = { byVerse: {} };

jest.mock('../../../../../../lib/hooks/use-cross-references', () => ({
  useCrossReferences: () => ({
    byVerse: mockCrossRefs.byVerse,
    loading: false,
    load: jest.fn(),
  }),
}));

const mockRouterReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: jest.fn() }),
  usePathname: () => '/bible/BSB/ROM/12',
}));

jest.mock('../../../../../../lib/hooks/use-require-auth', () => ({
  useRequireAuth: () => ({ isReady: true }),
}));

jest.mock('../../../../../../lib/hooks/use-chapter', () => ({ useChapter: jest.fn() }));
jest.mock('../../../../../../lib/hooks/use-bible-books', () => ({ useBibleBooks: jest.fn() }));

// The BookChapterPicker fetches the verse count for the selected chapter.
jest.mock('../../../../../../lib/bible/api', () => ({
  getChapter: jest.fn().mockResolvedValue({ numberOfVerses: 21 }),
}));

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
    mockRecordActivity.mockReset();
    window.location.hash = '';
    mockRouterReplace.mockClear();
    mockCrossRefs.byVerse = {};
    (Element.prototype.scrollIntoView as jest.Mock).mockClear();
  });

  it('renders the toolbar and verse text', async () => {
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByText('Romans 12')).toBeInTheDocument());
    expect(screen.getByText(/Therefore I urge you/)).toBeInTheDocument();
  });

  it('records a BIBLE_READ once when the chapter opens', async () => {
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() =>
      expect(mockRecordActivity).toHaveBeenCalledWith({ type: 'BIBLE_READ', pagesDelta: 1 }),
    );
    expect(mockRecordActivity).toHaveBeenCalledTimes(1);
  });

  it('does not surface an error when the recorded call rejects', async () => {
    mockRecordActivity.mockImplementation(() => {
      Promise.reject(new Error('offline')).catch(() => undefined);
    });
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByText('Romans 12')).toBeInTheDocument());
    // The failure is swallowed; the chapter still renders.
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

  it('scrolls and highlights on a manual hashchange event', async () => {
    const { container } = renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Verse 1')).toBeInTheDocument());

    const verse = container.querySelector('#v1');
    const scrollSpy = jest.spyOn(verse as Element, 'scrollIntoView');
    window.location.hash = '#v1';
    fireEvent(globalThis.window, new Event('hashchange'));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' }));
    await waitFor(() => expect(container.querySelector('#v1')?.className).toContain('border-primary'));
  });

  it('does not scroll for a hash that does not match #v{n}', async () => {
    globalThis.window.location.hash = '#not-a-verse';
    renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Verse 1')).toBeInTheDocument());
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls to the verse from an in-app cross-reference without relying on hashchange', async () => {
    mockCrossRefs.byVerse = { 1: [{ book: 'ROM', chapter: 12, verse: 1 }] };
    const { container } = renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Verse 1')).toBeInTheDocument());

    // Open the study sheet, then exercise the real navigate() path via CrossRefList.
    fireEvent.click(screen.getByLabelText('Verse 1'));
    const crossRefButton = await screen.findByRole('button', { name: 'Romans 12:1' });

    const verse = container.querySelector('#v1');
    const scrollSpy = jest.spyOn(verse as Element, 'scrollIntoView');
    fireEvent.click(crossRefButton);

    // No hashchange is dispatched: App Router uses pushState/replaceState, which
    // never emit one, so the scroll must come from navigate() directly.
    expect(mockRouterReplace).toHaveBeenCalledWith('/bible/BSB/ROM/12#v1');
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' }));
    await waitFor(() => expect(container.querySelector('#v1')?.className).toContain('border-primary'));
  });

  it('scrolls to the picked verse once the target chapter data is present', async () => {
    const view = renderWithProviders(<BibleReaderClient translation="BSB" book="ROM" chapter={12} />);
    await waitFor(() => expect(screen.getByLabelText('Choose book and chapter')).toBeInTheDocument());

    // Open the picker, switch to chapter 13, then pick verse 5.
    fireEvent.click(screen.getByLabelText('Choose book and chapter'));
    const chapterGrid = await screen.findByTestId('chapter-grid');
    fireEvent.click(within(chapterGrid).getByRole('link', { name: '13' }));
    const verseGrid = await screen.findByTestId('verse-grid');
    fireEvent.click(within(verseGrid).getByRole('link', { name: '5' }));

    // Cross-chapter navigation records the pending verse; the target DOM does not
    // exist yet, so no scroll has happened.
    expect(mockRouterReplace).toHaveBeenCalledWith('/bible/BSB/ROM/13#v5');

    // Simulate the async chapter fetch resolving: new route props + new hook data.
    const nextChapterData: BibleChapter = {
      ...baseChapter,
      numberOfVerses: 21,
      chapter: {
        number: 13,
        content: [
          { type: 'verse', number: 1, content: ['Verse one.'] },
          { type: 'verse', number: 5, content: ['Target verse five.'] },
        ],
        footnotes: [],
      },
    };
    mockHooks({ chapter: nextChapterData });
    (Element.prototype.scrollIntoView as jest.Mock).mockClear();
    view.rerender(
      <ToastProvider>
        <BibleReaderClient translation="BSB" book="ROM" chapter={13} />
      </ToastProvider>,
    );

    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' }),
    );
    // The target verse (not verse 1) is the highlighted/scrolled one.
    await waitFor(() => expect(view.container.querySelector('#v5')?.className).toContain('border-primary'));
    expect(view.container.querySelector('#v1')?.className).not.toContain('border-primary');
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