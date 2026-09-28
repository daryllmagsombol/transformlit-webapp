'use client';

import Link from 'next/link';
import { isOldTestament } from '../../lib/bible/refs';
import { Stagger, StaggerItem } from '../ui/stagger';
import type { TranslationBook } from '../../lib/bible/types';

interface BookGridProps {
  readonly books: TranslationBook[];
  readonly translation: string;
  readonly loading: boolean;
  /**
   * When provided, books behave as interactive buttons that report the selected
   * book id to the host (e.g. to open a chapter/verse picker) instead of
   * navigating straight to chapter 1.
   */
  readonly onSelectBook?: (bookId: string) => void;
}

const bookCardClass =
  'block w-full bg-surface-container-lowest dark:bg-surface-raised border border-outline-variant rounded-lg p-3 text-center hover:border-primary hover:shadow-soft transition-all';

function BookCard({
  book,
  translation,
  onSelectBook,
}: {
  readonly book: TranslationBook;
  readonly translation: string;
  readonly onSelectBook?: (bookId: string) => void;
}) {
  if (onSelectBook) {
    return (
      <button type="button" onClick={() => onSelectBook(book.id)} className={bookCardClass}>
        <span className="font-display text-small font-medium text-on-surface">{book.commonName}</span>
      </button>
    );
  }

  return (
    <Link href={`/bible/${translation}/${book.id}/1`} className={bookCardClass}>
      <span className="font-display text-small font-medium text-on-surface">{book.commonName}</span>
    </Link>
  );
}

export function BookGrid({ books, translation, loading, onSelectBook }: BookGridProps) {
  const ot = books.filter((b) => isOldTestament(b));
  const nt = books.filter((b) => !isOldTestament(b));

  if (loading) {
    return <p className="text-on-surface-variant py-8 text-center">Loading books…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {[
        { label: 'Old Testament', list: ot },
        { label: 'New Testament', list: nt },
      ].map(({ label, list }) => (
        <section key={label}>
          <h2 className="font-display text-headline-h4 text-on-surface mb-3">{label}</h2>
          <Stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {list.map((book) => (
              <StaggerItem key={book.id}>
                <BookCard book={book} translation={translation} onSelectBook={onSelectBook} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      ))}
    </div>
  );
}
