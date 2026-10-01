'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readerRecords, resetReaderRecordsForTests } from '../offline/reader-records';
import type { BookmarkRecord, HighlightRecord } from '../offline/contracts';

export { readerRecords, resetReaderRecordsForTests };

export interface ReaderAnnotations {
  readonly highlights: HighlightRecord[];
  readonly bookmarks: BookmarkRecord[];
  /** Re-reads the durable on-device records after a local-first mutation. */
  readonly refresh: () => void;
}

/**
 * Reads the on-device annotation records for one book. This is a local
 * IndexedDB read (account-scoped); it performs no network request and no
 * synchronization. `refresh` re-reads after a local-first mutation commits so
 * the panel reflects the durable local state.
 */
export function useReaderAnnotations(bookId: string): ReaderAnnotations {
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  // Monotonic request id so a slow read for a previous book cannot overwrite a
  // newer book's rows.
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => {
    const requestId = (requestIdRef.current += 1);
    const records = readerRecords();
    Promise.all([records.listHighlights(bookId), records.listBookmarks(bookId)])
      .then(([nextHighlights, nextBookmarks]) => {
        if (requestId !== requestIdRef.current) return;
        setHighlights(nextHighlights);
        setBookmarks(nextBookmarks);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        // An empty local store is the honest state before any edit.
        setHighlights([]);
        setBookmarks([]);
      });
  }, [bookId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { highlights, bookmarks, refresh };
}
