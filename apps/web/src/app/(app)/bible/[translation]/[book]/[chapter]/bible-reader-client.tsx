'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActivityType } from '@transformlit/shared';
import { useChapter } from '../../../../../../lib/hooks/use-chapter';
import { useBibleBooks } from '../../../../../../lib/hooks/use-bible-books';
import { useRequireAuth } from '../../../../../../lib/hooks/use-require-auth';
import { useBibleStore } from '../../../../../../store/bible-store';
import { BibleReaderView } from '../../../../../../components/bible/bible-reader-view';
import { LoadingSpinner } from '../../../../../../components/ui';
import { DownloadControls, type DownloadControlState } from '../../../../../../components/offline/download-controls';
import { canDownloadTranslationOffline, requiredAttribution } from '../../../../../../lib/bible/offline-rights';
import type { BibleCapabilities } from '../../../../../../lib/bible/repository';
import { offlineDownloadManager } from '../../../../../../lib/hooks/use-download';
import { useWritePermit } from '../../../../../../lib/hooks/use-write-permit';
import { recordActivity } from '../../../../../../lib/progress/record-activity';
import { formatRef } from '../../../../../../lib/bible/refs';

interface ReaderProps {
  readonly translation: string;
  readonly book: string;
  readonly chapter: number;
}

/** The online reader has every network-backed feature available. */
const ONLINE_CAPABILITIES: BibleCapabilities = {
  audio: true,
  remoteSearch: true,
  enrichment: true,
  realtime: true,
  navigation: true,
};

function BibleChapterDownload({ translation, book, chapter, label }: {
  readonly translation: string;
  readonly book: string;
  readonly chapter: number;
  readonly label: string;
}) {
  const [state, setState] = useState<DownloadControlState>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [persistenceGranted, setPersistenceGranted] = useState<boolean | null>(null);
  // Reactive permit: re-renders when ownership is established/cleared.
  const permitted = useWritePermit().permitted;
  const allowed = canDownloadTranslationOffline(translation);

  useEffect(() => {
    const manager = offlineDownloadManager();
    let current = true;
    const refresh = async () => {
      try {
        const [status, storage] = await Promise.all([
          manager.getBibleChapterStatus(translation, book, chapter),
          manager.estimateStorage(),
        ]);
        if (!current) return;
        setPersistenceGranted(storage.supported ? storage.persisted : null);
        if (status) {
          setState(status.status);
          setError(status.error);
        }
      } catch {
        if (current) setState('FAILED');
      }
    };
    const unsubscribe = manager.subscribe((progress) => {
      if (
        current && progress.kind === 'BIBLE_CHAPTER' &&
        progress.contentId === `${translation}:${book}:${chapter}`
      ) setState(progress.status);
    });
    refresh().catch(() => undefined);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [translation, book, chapter]);

  const onStart = useCallback(async () => {
    try {
      setError(null);
      setState('STAGING');
      const result = await offlineDownloadManager().startBibleChapterDownload(translation, book, chapter);
      setState(result.status);
    } catch (caught) {
      setState('FAILED');
      setError(caught instanceof Error ? caught.message : 'Bible chapter download failed');
    }
  }, [translation, book, chapter]);

  const onRetry = useCallback(async () => {
    try {
      setError(null);
      setState('STAGING');
      const result = await offlineDownloadManager().retryBibleChapterDownload(translation, book, chapter);
      setState(result.status);
    } catch (caught) {
      setState('FAILED');
      setError(caught instanceof Error ? caught.message : 'Bible chapter download failed');
    }
  }, [translation, book, chapter]);

  const onCancel = useCallback(async () => {
    await offlineDownloadManager().cancelBibleChapterDownload(translation, book, chapter);
    setState('CANCELLED');
  }, [translation, book, chapter]);

  const onRemove = useCallback(async () => {
    await offlineDownloadManager().removeBibleChapter(translation, book, chapter);
    setState('IDLE');
  }, [translation, book, chapter]);

  let deniedReason = 'Sign in to save this chapter offline.';
  if (!allowed) deniedReason = 'Offline rights are not documented for this translation.';
  else if (!permitted) deniedReason = 'Account identity is not established for private storage.';

  return (
    <DownloadControls
      label={label}
      state={state}
      error={error}
      canDownload={allowed && permitted}
      deniedReason={deniedReason}
      persistenceGranted={persistenceGranted}
      onStart={onStart}
      onRetry={onRetry}
      onCancel={onCancel}
      onRemove={onRemove}
    />
  );
}

export default function BibleReaderClient({ translation, book, chapter }: ReaderProps) {
  const router = useRouter();
  const { isReady } = useRequireAuth();
  const { chapter: data, words, loading, error } = useChapter(translation, book, chapter);
  const { books } = useBibleBooks(translation);
  const setLastPosition = useBibleStore((s) => s.setLastPosition);
  const recordedChapterRef = useRef<string | null>(null);

  useEffect(() => {
    setLastPosition(translation, { book, chapter });
  }, [translation, book, chapter, setLastPosition]);

  // Fire-and-forget BIBLE_READ once per successfully opened chapter.
  useEffect(() => {
    if (!isReady || loading || error || !data) return;
    const chapterKey = `${translation}/${book}/${chapter}`;
    if (recordedChapterRef.current === chapterKey) return;
    recordedChapterRef.current = chapterKey;
    recordActivity({ type: 'BIBLE_READ' as ActivityType, pagesDelta: 1 });
  }, [translation, book, chapter, isReady, loading, error, data]);

  const navigate = useCallback((href: string) => {
    router.replace(href);
  }, [router]);

  if (loading || !isReady) return <LoadingSpinner />;
  if (error || !data) {
    return <p className="text-error text-center py-12">Failed to load this chapter.</p>;
  }

  return (
    <BibleReaderView
      translation={translation}
      bookId={book}
      chapter={chapter}
      book={data.book}
      translationMeta={data.translation}
      content={data.chapter.content}
      footnotes={data.chapter.footnotes}
      words={words}
      audioLinks={data.thisChapterAudioLinks ?? null}
      books={books}
      capabilities={ONLINE_CAPABILITIES}
      attribution={requiredAttribution(translation)}
      onNavigate={navigate}
      onBack={() => router.push('/bible')}
      downloadControls={
        <BibleChapterDownload
          translation={translation}
          book={book}
          chapter={chapter}
          label={`${formatRef(data.book, chapter)} (${data.translation.shortName})`}
        />
      }
    />
  );
}
