import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BookChapterPicker } from './book-chapter-picker';
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

describe('BookChapterPicker', () => {
  beforeAll(() => {
    // jsdom lacks scrollIntoView; the picker scrolls the selected book into view.
    Element.prototype.scrollIntoView = jest.fn();
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
});