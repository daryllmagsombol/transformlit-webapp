'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { gql, type TypedDocumentNode } from '@apollo/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { apolloClient } from '../../../../../lib/apollo-client';
import {
  fetchAnnotationSnapshot,
  fetchReadProgress,
  networkReaderTransport,
  type PdfTextItem,
} from '../../../../../lib/reader/api';
import {
  BookRepository,
  type BookConversionStatus,
  type FrameHandle,
  type OpenedBook,
} from '../../../../../lib/reader/repository';
import { OfflineDatabase } from '../../../../../lib/offline/database';
import { accountLifecycle } from '../../../../../lib/offline/account-activation';
import {
  conflictResolver,
  progressChoicePage,
  type ConflictResolutionResult,
  type ConflictServerValue,
  type ConflictView,
  type ProgressChoice,
} from '../../../../../lib/offline/conflicts';
import type { BookVersionRecord } from '../../../../../lib/offline/contracts';
import { readerRecords, useReaderAnnotations } from '../../../../../lib/hooks/use-reader-records';
import type { ActivityType } from '@transformlit/shared';
import { BookReaderView } from '../../../../../components/reader/book-reader-view';
import { AnnotationPanel } from '../../../../../components/reader/annotation-panel';
import { ConflictPanel } from '../../../../../components/reader/conflict-panel';
import { recordActivity } from '../../../../../lib/progress/record-activity';
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

/**
 * Per-session BOOK_READ write guard. Page advances are frequent, so at most one
 * ping is sent per reader session to bound write volume (the server dedups
 * `activityCount` anyway). Module-level state resets on reload — accepted for v1.
 */
let bookReadRecorded = false;

/** Clears the per-session BOOK_READ guard. Exposed for tests only. */
export function resetBookReadGuardForTests(): void {
  bookReadRecorded = false;
}

/**
 * Content version sentinel for session (non-version-pinned) reader endpoints.
 *
 * The online reader's reading-session/page endpoints are not version-pinned, so
 * the repository reports `0` here. Every `ReaderRecords` mutation — progress AND
 * annotations — resolves a non-positive value to the locally downloaded active
 * version (or `1`), because the server operation envelope requires a POSITIVE
 * integer content version. The reader therefore passes this sentinel through to
 * `<AnnotationPanel>` and relies on the in-`ReaderRecords` resolver, so no
 * persisted/queued operation is ever stamped `0`.
 *
 * Task 11 must send the server's current supported version before dispatch.
 */
const CURRENT_CONTENT_VERSION = 0;

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
        contentVersion: CURRENT_CONTENT_VERSION,
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

/** Authoritative server records keyed by entity id, best-effort for comparison. */
async function loadServerValues(bookId: string): Promise<Record<string, ConflictServerValue>> {
  try {
    const snapshot = await fetchAnnotationSnapshot(bookId);
    const values: Record<string, ConflictServerValue> = {};
    for (const row of snapshot.annotations) {
      values[row.id] = { revision: row.revision, value: row as unknown as Record<string, unknown> };
    }
    return values;
  } catch {
    return {};
  }
}

/** The authoritative server reading position, or null when unavailable. */
async function loadProgressServerValue(bookId: string): Promise<ConflictServerValue | null> {
  try {
    const progress = await fetchReadProgress(bookId);
    if (!progress) return null;
    return {
      revision: progress.revision,
      value: { currentPage: progress.currentPage, revision: progress.revision },
    };
  } catch {
    return null;
  }
}

/** Downloaded content versions for the book, or undefined when unavailable. */
async function loadAvailableContentVersions(bookId: string): Promise<readonly number[] | undefined> {
  if (globalThis.indexedDB === undefined || typeof IDBKeyRange === 'undefined') return undefined;
  const owner = accountLifecycle().getOwner();
  if (!owner) return undefined;
  const range = IDBKeyRange.bound(
    [owner.subject, bookId],
    [owner.subject, bookId, Number.MAX_SAFE_INTEGER],
  );
  const versions = await new OfflineDatabase().getAllByIndex<BookVersionRecord>(
    'bookVersions',
    'subjectBookVersion',
    range,
  );
  return versions.map((version) => version.contentVersion);
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
  const [pageError, setPageError] = useState<string | null>(null);
  const pageCount = opened?.pageCount ?? 0;
  const { highlights, bookmarks, refresh } = useReaderAnnotations(bookId);
  const annotations = useMemo(
    () => ({ highlights, bookmarks, refresh }),
    [highlights, bookmarks, refresh],
  );
  const [conflicts, setConflicts] = useState<ConflictView[]>([]);
  const [availableContentVersions, setAvailableContentVersions] = useState<readonly number[] | undefined>(undefined);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictStatus, setConflictStatus] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const loadConflicts = useCallback(async () => {
    const serverValues = await loadServerValues(bookId);
    let next = await conflictResolver().listConflicts(bookId, serverValues);
    // A PROGRESS_SET conflict's server value comes from the SEPARATE revisioned
    // progress endpoint, not the annotation snapshot.
    if (next.some((conflict) => conflict.conflictKind === 'PROGRESS' && conflict.serverValue === null)) {
      const progress = await loadProgressServerValue(bookId);
      if (progress) {
        for (const conflict of next) {
          if (conflict.conflictKind === 'PROGRESS') serverValues[conflict.operationId] = progress;
        }
        next = await conflictResolver().listConflicts(bookId, serverValues);
      }
    }
    setConflicts(next);
  }, [bookId]);

  useEffect(() => {
    loadConflicts().catch(() => undefined);
  }, [loadConflicts]);

  useEffect(() => {
    let cancelled = false;
    loadAvailableContentVersions(bookId)
      .then((versions) => {
        if (!cancelled) setAvailableContentVersions(versions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const applyResolution = useCallback(
    async (run: () => Promise<ConflictResolutionResult>, message: string) => {
      setConflictBusy(true);
      setConflictError(null);
      try {
        const result = await run();
        if (result.status === 'RESOLVED') {
          setConflictStatus(message);
          refresh();
          await loadConflicts();
        } else {
          setConflictError(result.error ?? 'Could not resolve the conflict');
        }
      } catch {
        setConflictError('Could not resolve the conflict');
      } finally {
        setConflictBusy(false);
      }
    },
    [loadConflicts, refresh],
  );

  const chooseServer = useCallback(
    (conflict: ConflictView) =>
      applyResolution(() => conflictResolver().chooseServer(conflict), 'Kept the server version'),
    [applyResolution],
  );
  const keepOfflineCopy = useCallback(
    (conflict: ConflictView) =>
      applyResolution(() => conflictResolver().keepOfflineCopy(conflict), 'Kept your offline version'),
    [applyResolution],
  );
  const retarget = useCallback(
    (conflict: ConflictView, successorOperationIds: readonly string[]) =>
      applyResolution(
        () => conflictResolver().retarget(conflict, successorOperationIds),
        'Retargeted your later edits',
      ),
    [applyResolution],
  );


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
  //
  // Local-first: the on-device progress record is authoritative and is read
  // synchronously from IndexedDB; the server read is a fallback for a first
  // visit on a new device. No write happens here.
  useEffect(() => {
    if (initialPage !== undefined) return;
    let cancelled = false;
    (async () => {
      const local = await readerRecords().getProgress(bookId);
      if (!cancelled && local?.currentPage) {
        setPage(local.currentPage);
        return;
      }
      try {
        const progress = await fetchReadProgress(bookId);
        if (!cancelled && progress?.currentPage) setPage(progress.currentPage);
      } catch {
        /* no saved progress yet — start at page 1 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, initialPage]);

  /**
   * Persists progress locally on a deliberate page change. Durability is
   * immediate (one atomic IndexedDB transaction); only Task 11's DISPATCH is
   * debounced/coalesced. There is no server write and no teardown flush.
   */
  const persistProgress = useCallback(
    (nextPage: number, contentVersion: number) => {
      readerRecords()
        .saveProgress({ bookId, contentVersion, currentPage: nextPage, scrollY: null })
        .catch(() => {
          /* the panel surfaces local save failures; progress is best-effort UI state */
        });
    },
    [bookId],
  );

  /**
   * Resolve a PROGRESS conflict by the explicit chosen position and ADOPT it in
   * the reader + local record (so the choice is not a no-op). LOCAL adopts the
   * offline page; SERVER adopts the authoritative server page.
   */
  const resolveProgress = useCallback(
    (conflict: ConflictView, choice: ProgressChoice) => {
      const chosenPage = progressChoicePage(conflict, choice);
      return applyResolution(
        async () => {
          const result = await conflictResolver().resolveProgress(conflict, choice);
          if (result.status === 'RESOLVED' && chosenPage !== null) {
            setPage(chosenPage);
            persistProgress(chosenPage, opened?.contentVersion ?? CURRENT_CONTENT_VERSION);
          }
          return result;
        },
        choice === 'LOCAL' ? 'Resumed at your page' : 'Resumed at the server page',
      );
    },
    [applyResolution, persistProgress, opened?.contentVersion],
  );

  useEffect(() => {
    if (!opened) return;
    if (opened.conversionStatus !== 'READY') return;
    let cancelled = false;
    setItems(null);
    // Clear the previous frame so a failed page change can never leave the
    // previous page's raster visible (silent wrong page).
    setFrame(null);
    setPageError(null);

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
        if (!cancelled) {
          setItems([]);
          setFrame(null);
          setPageError('This page could not be loaded. Check your connection and try again.');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bookId, opened, page]);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 1), pageCount || 1);
      setPage(clamped);
      persistProgress(clamped, opened?.contentVersion ?? CURRENT_CONTENT_VERSION);
      if (!bookReadRecorded) {
        bookReadRecorded = true;
        recordActivity({ type: 'BOOK_READ' as ActivityType, pagesDelta: 1 });
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('page', String(clamped));
      router.replace(`/books/${bookId}/read?${params.toString()}`);
    },
    [bookId, pageCount, router, searchParams, persistProgress, opened?.contentVersion],
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

  if (!opened) {
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
      pageError={pageError}
      conflicts={
        conflicts.length > 0 || conflictStatus !== null || conflictError !== null ? (
          <ConflictPanel
            conflicts={conflicts}
            busy={conflictBusy}
            statusMessage={conflictStatus}
            error={conflictError}
            onChooseServer={chooseServer}
            onKeepOfflineCopy={keepOfflineCopy}
            onRetarget={retarget}
            onResolveProgress={resolveProgress}
          />
        ) : null
      }
      annotations={
        <AnnotationPanel
          bookId={bookId}
          contentVersion={opened.contentVersion}
          page={page}
          items={items}
          highlights={annotations.highlights}
          bookmarks={annotations.bookmarks}
          records={readerRecords()}
          availableContentVersions={availableContentVersions}
          onRecordsChanged={annotations.refresh}
        />
      }
    />
  );
}
