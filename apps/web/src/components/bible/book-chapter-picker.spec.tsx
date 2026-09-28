import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BookChapterPicker } from './book-chapter-picker';
import { getChapter } from '../../lib/bible/api';
import type { TranslationBook } from '../../lib/bible/types';

jest.mock('next/link', () => {
  return function MockLink({
    children,
    href,
    ...rest
  }: { children?: ReactNode; href?: string } & Record<string, unknown>) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  };
});

jest.mock('../../lib/bible/api', () => ({
  getChapter: jest.fn(),
}));

const getChapterMock = getChapter as jest.MockedFunction<typeof getChapter>;

const GENESIS: TranslationBook = {
  id: 'GEN',
  name: 'Genesis',
  commonName: 'Genesis',
  title: null,
  order: 1,
  numberOfChapters: 50,
  firstChapterNumber: 1,
  lastChapterNumber: 50,
  totalNumberOfVerses: 1533,
};

const EXODUS: TranslationBook = {
  id: 'EXO',
  name: 'Exodus',
  commonName: 'Exodus',
  title: null,
  order: 2,
  numberOfChapters: 40,
  firstChapterNumber: 1,
  lastChapterNumber: 40,
  totalNumberOfVerses: 1213,
};

function verseCountFor(book: string): number {
  return book === 'EXO' ? 7 : 5;
}

describe('BookChapterPicker', () => {
  beforeAll(() => {
    // jsdom lacks scrollIntoView; the picker scrolls the selected book into view.
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    getChapterMock.mockReset();
    getChapterMock.mockImplementation(async (_translation, book) => ({
      numberOfVerses: verseCountFor(book),
    }) as Awaited<ReturnType<typeof getChapter>>);
  });

  it('renders the passed book chapters in the right pane', () => {
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    // "Genesis" appears as both the left-pane book button and the right-pane heading.
    expect(screen.getAllByText('Genesis')).toHaveLength(2);
    // First and last Genesis chapters are rendered; a chapter beyond Genesis's 50 is not.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.queryByText('51')).not.toBeInTheDocument();
  });

  it('updates the right pane when a different book is clicked', () => {
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    fireEvent.click(screen.getByText('Exodus'));

    // "Exodus" now appears as both the left-pane button and the right-pane heading.
    expect(screen.getAllByText('Exodus')).toHaveLength(2);
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });

  it('only highlights the current chapter when the selected book is the current book', () => {
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    expect(screen.getByText('3').className).toContain('bg-brand-orange-dark');

    fireEvent.click(screen.getByText('Exodus'));

    expect(screen.getByText('3').className).not.toContain('bg-brand-orange-dark');
  });

  it('defaults to the first book and its first chapter when no book/chapter is passed', async () => {
    render(
      <BookChapterPicker open onClose={() => {}} books={[GENESIS, EXODUS]} translation="eng_bsb" />,
    );

    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open chapter' })).toHaveAttribute(
      'href',
      '/bible/eng_bsb/GEN/1',
    );
    await waitFor(() => expect(screen.getByTestId('verse-grid')).toBeInTheDocument());
  });

  it('renders a verse grid with the fetched verse count for the selected chapter', async () => {
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('verse-grid')).toBeInTheDocument());
    expect(getChapterMock).toHaveBeenCalledWith('eng_bsb', 'GEN', 3);
    expect(within(screen.getByTestId('verse-grid')).getAllByRole('link')).toHaveLength(5);
  });

  it('links each verse to the chapter with a #v{n} hash', async () => {
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('verse-grid')).toBeInTheDocument());
    const verseThree = within(screen.getByTestId('verse-grid')).getByText('3');
    expect(verseThree).toHaveAttribute('href', '/bible/eng_bsb/GEN/3#v3');
  });

  it('resets the selected chapter to the new book first chapter when the book changes', async () => {
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('verse-grid')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Exodus'));

    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByTestId('verse-grid')).getAllByRole('link')).toHaveLength(7),
    );
    expect(getChapterMock).toHaveBeenCalledWith('eng_bsb', 'EXO', 1);
  });

  it('offers an "Open chapter" link that omits the verse hash', async () => {
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('verse-grid')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Open chapter' })).toHaveAttribute(
      'href',
      '/bible/eng_bsb/GEN/3',
    );
  });

  it('shows a retry affordance when the verse count fetch fails', async () => {
    getChapterMock.mockRejectedValueOnce(new Error('offline'));
    render(
      <BookChapterPicker
        open
        onClose={() => {}}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
      />,
    );

    await waitFor(() => expect(screen.getByText('Could not load verses.')).toBeInTheDocument());
    expect(screen.queryByTestId('verse-grid')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('verse-grid')).toBeInTheDocument());
  });

  // The reader passes `onNavigate` so a same-chapter `#v{n}` jump routes through
  // its own scroll logic (pushState emits no `hashchange`).
  it('routes verse and "Open chapter" clicks through onNavigate when provided', async () => {
    const onNavigate = jest.fn();
    const onClose = jest.fn();
    render(
      <BookChapterPicker
        open
        onClose={onClose}
        books={[GENESIS, EXODUS]}
        translation="eng_bsb"
        bookId="GEN"
        chapter={3}
        onNavigate={onNavigate}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('verse-grid')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('verse-grid')).getByText('3'));

    expect(onNavigate).toHaveBeenCalledWith('/bible/eng_bsb/GEN/3#v3');
    expect(onClose).toHaveBeenCalled();

    onNavigate.mockClear();
    onClose.mockClear();
    fireEvent.click(screen.getByRole('link', { name: 'Open chapter' }));

    expect(onNavigate).toHaveBeenCalledWith('/bible/eng_bsb/GEN/3');
    expect(onClose).toHaveBeenCalled();
  });
});
