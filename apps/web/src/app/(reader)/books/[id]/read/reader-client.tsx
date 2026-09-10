'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gql } from '@apollo/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { apolloClient } from '../../../../../lib/apollo-client';
import {
  openReadingSession,
  pageFrameUrl,
  fetchPageText,
  fetchReadProgress,
  saveReaderProgress,
  PdfTextItem,
} from '../../../../../lib/reader/api';
import { useReaderStore } from '../../../../../store';
import { PageCanvas } from '../../../../../components/reader/page-canvas';
import { ReaderToolbar } from '../../../../../components/reader/reader-toolbar';

const BOOK_MANIFEST_QUERY = gql`
  query ReaderBook($id: ID!) {
    book(id: $id) {
      id
      title
      author
      format
      pageCount
      conversionStatus
      toc {
        id
        title
        page
        depth
      }
    }
  }
`;

interface Manifest {
  id: string;
  title: string;
  author?: string;
  format?: 'PDF' | 'EPUB';
  pageCount?: number;
  conversionStatus: 'NOT_APPLICABLE' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  toc: Array<{ id: string; title: string; page: number; depth: number }>;
}

/** How long page positions settle before the server save fires. */
const PROGRESS_SAVE_DEBOUNCE_MS = 1500;

export function ReaderClient({ bookId, initialPage }: { readonly bookId: string; readonly initialPage?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const theme = useReaderStore((s) => s.theme);
  const setLastPage = useReaderStore((s) => s.setLastPage);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage ?? 1);
  const [items, setItems] = useState<PdfTextItem[] | null>(null);
  const pageCount = manifest?.pageCount ?? 0;
  const sessionReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    let cancelled = false;
    apolloClient
      .query<{ book: Manifest }>({ query: BOOK_MANIFEST_QUERY, variables: { id: bookId } })
      .then((result) => {
        const book = result.data?.book;
        if (!cancelled && book) setManifest(book);
      })
      .catch(() => {
        if (!cancelled) setError('You do not have access to this book, or it is not available.');
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // One session per mount; the API slides its TTL as pages are fetched.
  useEffect(() => {
    if (sessionReady.current) return;
    sessionReady.current = true;
    openReadingSession(bookId).catch(() => setError('Could not start a reading session.'));
  }, [bookId]);

  // Resume only when the URL did not pin a page — an explicit ?page always wins.
  useEffect(() => {
    if (initialPage !== undefined) return;
    let cancelled = false;
    fetchReadProgress(bookId)
      .then((progress) => {
        if (!cancelled && progress?.currentPage) setPage(progress.currentPage);
      })
      .catch(() => {
        /* no saved progress yet — start at page 1 */
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, initialPage]);

  useEffect(() => {
    if (!manifest || manifest.conversionStatus !== 'READY') return;
    let cancelled = false;
    setItems(null);
    fetchPageText(bookId, page)
      .then((text) => {
        if (!cancelled) setItems(text.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    // Local position updates instantly; the server save is debounced on page settle.
    setLastPage(bookId, page);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveReaderProgress(bookId, page).catch(() => {
        /* a later page-settle save retries */
      });
    }, PROGRESS_SAVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [bookId, manifest, page]);

  // Flush the position when the tab is hidden or the reader unmounts.
  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') {
        saveReaderProgress(bookId, pageRef.current).catch(() => {
          /* best-effort on teardown */
        });
      }
    };
    document.addEventListener('visibilitychange', flushOnHide);
    return () => {
      document.removeEventListener('visibilitychange', flushOnHide);
      saveReaderProgress(bookId, pageRef.current).catch(() => {
        /* best-effort on teardown */
      });
    };
  }, [bookId]);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 1), pageCount || 1);
      setPage(clamped);
      const params = new URLSearchParams(searchParams.toString());
      params.set('page', String(clamped));
      router.replace(`/books/${bookId}/read?${params.toString()}`);
    },
    [bookId, pageCount, router, searchParams],
  );

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface p-6 text-center">
        <div>
          <p className="font-display text-headline-h3 text-on-surface">This book can’t be opened</p>
          <p className="font-body text-body mt-2 text-on-surface-variant">{error}</p>
          <button type="button" className="mt-4 text-primary underline" onClick={() => router.push('/books')}>
            Back to library
          </button>
        </div>
      </main>
    );
  }

  if (!manifest) {
    return <div className="flex min-h-dvh items-center justify-center bg-surface" data-testid="reader-loading" />;
  }

  return (
    <div data-reader-theme={theme} className="flex min-h-dvh flex-col bg-paper text-on-surface">
      <ReaderToolbar
        title={manifest.title}
        page={page}
        pageCount={pageCount}
        onPageChange={goToPage}
        onBack={() => router.push('/books')}
      />
      <main className="flex flex-1 items-start justify-center overflow-auto p-4">
        <PageCanvas bookId={bookId} page={page} items={items} />
      </main>
    </div>
  );
}
