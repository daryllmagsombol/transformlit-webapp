'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import type { GraphQLBook } from '@transformlit/shared';
import {
  useToast,
  BookCard,
  BookCardSkeleton,
  ReadingProgressCard,
  LoadingSpinner,
} from '../../../components/ui';
import { apolloClient } from '../../../lib/apollo-client';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';

// ── GraphQL Queries ──────────────────────────────────────────────────────────

const BOOKS_QUERY = gql`
  query Books {
    books {
      id
      title
      author
      description
      coverUrl
      price
      currency
      accessLevel
      status
      conversionStatus
      totalPages
      pageCount
      publishedAt
      createdAt
    }
  }
`;

// ── Mock: Currently Reading ──────────────────────────────────────────────────

const CURRENTLY_READING = [
  {
    id: 'reading-1',
    title: 'The Architect of Thought',
    author: 'Elena Voss',
    coverUrl: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=300&q=80',
    currentPage: 212,
    totalPages: 340,
  },
  {
    id: 'reading-2',
    title: 'Quiet Echoes',
    author: 'Samuel Reed',
    coverUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=300&q=80',
    currentPage: 18,
    totalPages: 150,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

type FilterKey = 'ALL' | 'FREE' | 'PREMIUM';
type SortKey = 'NEWEST' | 'TITLE' | 'PRICE';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All Books' },
  { key: 'FREE', label: 'Community' },
  { key: 'PREMIUM', label: 'Premium' },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'NEWEST', label: 'Newest' },
  { key: 'TITLE', label: 'Title A-Z' },
  { key: 'PRICE', label: 'Price' },
];

function formatPrice(book: GraphQLBook): number {
  if (book.accessLevel === 'FREE') return 0;
  return book.price ?? Infinity;
}

// ── Books Page ───────────────────────────────────────────────────────────────

export default function BooksClient() {
  const { isReady } = useRequireAuth();
  const { addToast } = useToast();
  const push = useRouter().push;

  const [books, setBooks] = useState<GraphQLBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [sort, setSort] = useState<SortKey>('NEWEST');
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await apolloClient.query<{ books: GraphQLBook[] }>({ query: BOOKS_QUERY });
      setBooks(result.data?.books ?? []);
    } catch {
      addToast('Failed to load books. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isReady) loadData();
  }, [isReady, loadData]);

  const filteredBooks = useMemo(() => {
    let next = [...books];

    if (filter === 'FREE') {
      next = next.filter((b) => b.accessLevel === 'FREE');
    } else if (filter === 'PREMIUM') {
      next = next.filter((b) => b.accessLevel !== 'FREE');
    }

    if (sort === 'NEWEST') {
      next.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    } else if (sort === 'TITLE') {
      next.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'PRICE') {
      next.sort((a, b) => formatPrice(a) - formatPrice(b));
    }

    return next;
  }, [books, filter, sort]);

  const handleBuy = useCallback(() => {
    addToast('Paid books coming soon.', 'info');
  }, [addToast]);

  const handleRead = useCallback(
    (book?: { id: string; conversionStatus?: string | null }) => {
      if (!book) {
        addToast('Reader opening soon.', 'info');
        return;
      }
      if (book.conversionStatus !== 'READY') {
        addToast('This book is still being prepared.', 'info');
        return;
      }
      push(`/books/${book.id}/read`);
    },
    [addToast, push],
  );

  // Placeholder actions (resume card + FAB) are not wired to real books yet.
  const handleComingSoon = useCallback(() => {
    addToast('Reader opening soon.', 'info');
  }, [addToast]);

  const handleLoadMore = useCallback(async () => {
    setLoadMoreLoading(true);
    // No pagination yet — simulate a small delay and refresh.
    setTimeout(() => {
      setLoadMoreLoading(false);
      addToast('No more books to load.', 'info');
    }, 600);
  }, [addToast]);

  const bookSkeletonKeys = useMemo(
    () => Array.from({ length: 10 }, () => crypto.randomUUID()),
    [],
  );

  const renderBooksContent = () => {
    if (loading) {
      return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
          {bookSkeletonKeys.map((key) => (
            <BookCardSkeleton key={key} />
          ))}
        </div>
      );
    }

    if (filteredBooks.length === 0) {
      function getEmptyMessage(): string {
        if (filter === 'ALL') return 'The library is empty right now. Check back soon for new titles.';
        return 'No books match the selected filter. Try another category.';
      }
      return (
        <div className="bg-surface-container-low rounded-xl border border-outline-variant p-10 md:p-16 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-container/20 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-primary text-3xl">menu_book</span>
          </div>
          <h3 className="font-display text-headline-h3 text-on-surface mb-2">No books found</h3>
          <p className="font-body text-body text-on-surface-variant">
            {getEmptyMessage()}
          </p>
        </div>
      );
    }

    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
          {filteredBooks.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onRead={() => handleRead(book)}
              onBuy={handleBuy}
            />
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadMoreLoading}
            className="px-8 py-3 border-2 border-primary text-primary rounded-lg font-display text-headline-h4 font-bold hover:bg-primary hover:text-on-primary transition-colors active:scale-95 disabled:opacity-50"
          >
            {loadMoreLoading ? 'Loading...' : 'Discover More Books'}
          </button>
        </div>
      </>
    );
  };

  if (!isReady) {
    return <LoadingSpinner />;
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          HERO: CURRENTLY READING
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-start sm:items-end justify-between mb-5">
          <div>
            <span className="font-micro text-xs uppercase tracking-[0.2em] text-brand-orange-dark mb-1 block">
              Currently Reading
            </span>
            <h1 className="font-display text-display-mobile md:text-display text-on-surface">
              My Reading List
            </h1>
          </div>
          <button
            onClick={() => addToast('Stats coming soon.', 'info')}
            className="font-small text-small font-medium text-brand-orange-dark hover:underline hidden sm:block"
          >
            View Library Stats &rarr;
          </button>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-paper-warm border border-outline-variant shadow-sm p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-primary">auto_stories</span>
            <h2 className="font-display text-headline-h3 text-on-surface">Currently Reading</h2>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar -mx-5 px-5 md:mx-0 md:px-0">
            {CURRENTLY_READING.map((book) => (
              <ReadingProgressCard
                key={book.id}
                coverUrl={book.coverUrl}
                title={book.title}
                author={book.author}
                currentPage={book.currentPage}
                totalPages={book.totalPages}
                onContinue={handleComingSoon}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          BROWSE BOOKS
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <h2 className="font-display text-headline-h2 text-on-surface">Browse Books</h2>

          <div className="relative flex items-center gap-3 overflow-x-auto no-scrollbar">
            {/* Filter chips */}
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-2 rounded-full font-display text-small font-bold whitespace-nowrap transition-all active:scale-95 ${
                  filter === f.key
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'bg-surface-container-high text-on-surface-variant border border-outline-variant hover:bg-surface-container'
                }`}
              >
                {f.label}
              </button>
            ))}

            <div className="w-px h-6 bg-outline-variant mx-1" />

            {/* Sort dropdown */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort books"
              className="bg-surface-container-high border border-outline-variant rounded-full px-4 py-2 font-display text-small text-on-surface focus:outline-none focus:border-primary cursor-pointer"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>

            <div
              className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-surface to-transparent md:hidden"
              aria-hidden="true"
            />
          </div>
        </div>

        {renderBooksContent()}
      </section>

      {/* ═══════════════════════════════════════════════════════════
          FAB
          ═══════════════════════════════════════════════════════════ */}
      <div className="fixed bottom-24 right-6 md:bottom-10 md:right-10 z-50">
        <button
          onClick={handleComingSoon}
          className="w-14 h-14 bg-brand-orange-dark text-on-primary rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform group"
          aria-label="Track reading progress"
        >
          <span className="material-symbols-outlined text-[28px] group-hover:rotate-12 transition-transform duration-300">
            add
          </span>
        </button>
      </div>
    </>
  );
}
