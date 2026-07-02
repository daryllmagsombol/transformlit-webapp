'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { gql } from '@apollo/client';
import type { GraphQLBook } from '@transformlit/shared';
import {
  useToast,
  BookCard,
  BookCardSkeleton,
  ReadingProgressCard,
} from '../../components/ui';
import { useAuthStore } from '../../store';
import { apolloClient } from '../../lib/apollo-client';

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
      totalPages
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
  const token = useAuthStore((s) => s.token);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const router = useRouter();
  const { addToast } = useToast();

  const [books, setBooks] = useState<GraphQLBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [sort, setSort] = useState<SortKey>('NEWEST');
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await apolloClient.query({ query: BOOKS_QUERY });
      setBooks(result.data.books ?? []);
    } catch {
      addToast('Failed to load books. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!token) { router.push('/login'); return; }
    loadData();
  }, [token, isHydrated, router, loadData]);

  if (!isHydrated || !token) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-on-surface-variant font-small">Loading…</span>
        </div>
      </div>
    );
  }

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

  const handleRead = useCallback(() => {
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

  if (!token) return null;

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          HERO: CURRENTLY READING
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-display text-display-mobile md:text-display text-on-surface">
            Library
          </h1>
          <span className="font-micro text-micro uppercase tracking-wider text-on-surface-variant hidden sm:inline">
            {books.length} Title{books.length !== 1 ? 's' : ''}
          </span>
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
                onContinue={handleRead}
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

          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
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
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
            {Array.from({ length: 10 }).map((_, i) => (
              <BookCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredBooks.length > 0 ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
              {filteredBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  onRead={handleRead}
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
        ) : (
          <div className="bg-surface-container-low rounded-xl border border-outline-variant p-10 md:p-16 text-center">
            <div className="w-16 h-16 rounded-full bg-primary-container/20 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-primary text-3xl">menu_book</span>
            </div>
            <h3 className="font-display text-headline-h3 text-on-surface mb-2">No books found</h3>
            <p className="font-body text-body text-on-surface-variant">
              {filter === 'ALL'
                ? 'The library is empty right now. Check back soon for new titles.'
                : 'No books match the selected filter. Try another category.'}
            </p>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════
          FAB
          ═══════════════════════════════════════════════════════════ */}
      <div className="fixed bottom-24 right-6 md:bottom-10 md:right-10 z-50">
        <button
          onClick={handleRead}
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
