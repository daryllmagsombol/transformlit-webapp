'use client';

import Link from 'next/link';
import { isOldTestament } from '../../lib/bible/refs';
import type { TranslationBook } from '../../lib/bible/types';

interface BookGridProps {
  books: TranslationBook[];
  translation: string;
  loading: boolean;
}

function BookCard({ book, translation }: { book: TranslationBook; translation: string }) {
  return (
    <Link
      href={`/bible/${translation}/${book.id}/1`}
      className="bg-surface-container-lowest dark:bg-surface-raised border border-outline-variant rounded-lg p-3 text-center hover:border-primary hover:shadow-soft transition-all"
    >
      <span className="font-display text-small font-medium text-on-surface">{book.commonName}</span>
    </Link>
  );
}

export function BookGrid({ books, translation, loading }: BookGridProps) {
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {list.map((book) => (
              <BookCard key={book.id} book={book} translation={translation} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
