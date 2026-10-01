'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gql, type TypedDocumentNode } from '@apollo/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { apolloClient } from '../../../../../lib/apollo-client';
import { fetchReadProgress, saveReaderProgress, networkReaderTransport, type PdfTextItem } from '../../../../../lib/reader/api';
import {
  BookRepository,
  type BookConversionStatus,
  type FrameHandle,
  type OpenedBook,
} from '../../../../../lib/reader/repository';
import { OfflineDatabase } from '../../../../../lib/offline/database';
import { accountLifecycle } from '../../../../../lib/offline/account-activation';
import { BookReaderView } from '../../../../../components/reader/book-reader-view';
import { useReaderStore } from '../../../../../store';

const BOOK_MANIFEST_QUERY: TypedDocumentNode<{ book: Manifest }, { id: string }> = gql`
  query ReaderBook($id: String!) {
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
  conversionStatus: BookConversionStatus;
  toc: Array<{ id: string; title: string; page: number; depth: number }>;
}

/** How long page positions settle before the server save fires. */
const PROGRESS_SAVE_DEBOUNCE_MS = 1500;

/**
 * The online reader's repository. The network paths resolve metadata, start the
 * reading session, and read frames/text; the local path is never used here.
 */
function createReaderRepository(): BookRepository {
  return new BookRepository({
    database: new OfflineDatabase(),
    getOwner: () => accountLifecycle().getOwner(),
    fetchMetadata: async (bookId) => {
      const result = await apolloClient.query({ query: BOOK_MANIFEST_QUERY, variables: { id: bookId } });
      const book = result.data?.book;
      if (!book) throw new Error('Book manifest is unavailable');
      return {
        title: book.title,
        author: book.author ?? null,
        pageCount: book.pageCount ?? 0,
        // Session endpoints are not version-pinned; use 0 as "current" sentinel.
        contentVersion: 0,
        conversionStatus: book.conversionStatus,
        toc: book.toc.map((entry) => ({
          id: entry.id,
          title: entry.title,
          pageNumber: entry.page,
          order: entry.page,
        })),
      };
    },
    openSession: networkReaderTransport.openSession,
    fetchText: networkReaderTransport.fetchText,
    frameUrl: networkReaderTransport.frameUrl,
  });
}

export function ReaderClient({ bookId, initialPage }: { readonly bookId: string; readonly initialPage?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const theme = useReaderStore((s) => s.theme);
  const [opened, setOpened] = useState<OpenedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage ?? 1);
  const [items, setItems] = useState<PdfTextItem[] | null>(null);
  const [frame, setFrame] = useState<FrameHandle | null>(null);
  const pageCount = opened?.pageCount ?? 0;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    let cancelled = false;
    createReaderRepository()
      .open(bookId)
      .then((result) => {
        if (!cancelled) setOpened(result);
      })
      .catch(() => {
        if (!cancelled) setError('You do not have access to this book, or it is not available.');
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // A deep-linked ?page or a stale saved position can exceed the real page
  // count; clamp once the manifest tells us how many pages exist.
  useEffect(() => {
    if (!opened?.pageCount) return;
    setPage((current) => Math.min(Math.max(current, 1), opened.pageCount));
  }, [opened?.pageCount]);

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
    if (!opened) return;
    if (opened.conversionStatus !== 'READY') return;
    let cancelled = false;
    setItems(null);

    // The repository owns the frame URL lifecycle; PageCanvas disposes the
    // previous handle on change/unmount. An in-flight open resolved after
    // unmount is disposed here so its Blob URL (if any) cannot leak.
    opened.openPage(page).then(
      (result) => {
        if (cancelled) {
          result.frame.dispose();
          return;
        }
        setFrame(result.frame);
        setItems(result.items);
      },
      () => {
        if (!cancelled) setItems([]);
      },
    );

    // Reading position is owned by the account-scoped offline store (added in
    // a later task); the reader store no longer keeps an authoritative copy.
    // The debounced server save below remains best-effort until then.
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
  }, [bookId, opened, page]);

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

  if (!opened || !frame) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-surface"
        data-testid="reader-loading"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <BookReaderView
      title={opened.title}
      page={page}
      pageCount={pageCount}
      items={items}
      frame={frame}
      capabilities={opened.capabilities}
      onPageChange={goToPage}
      onBack={() => router.push('/books')}
      theme={theme}
    />
  );
}
