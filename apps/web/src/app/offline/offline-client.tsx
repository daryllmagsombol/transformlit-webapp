'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookRepository, type FrameHandle, type OpenedBook } from '../../lib/reader/repository';
import { BibleRepository, type OpenedChapter } from '../../lib/bible/repository';
import { OfflineDatabase } from '../../lib/offline/database';
import { accountLifecycle, hydrateAccountLifecycle } from '../../lib/offline/account-activation';
import type { DownloadManifestRecord } from '../../lib/offline/contracts';
import type { PdfTextItem } from '../../lib/reader/api';
import { BookReaderView } from '../../components/reader/book-reader-view';
import { BibleReaderView } from '../../components/bible/bible-reader-view';
import { LoadingSpinner } from '../../components/ui';
import { getBookName } from '../../lib/bible/config';
import type { TranslationBook } from '../../lib/bible/types';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type HubView =
  | { kind: 'list' }
  | { kind: 'book'; bookId: string; page: number }
  | { kind: 'bible'; translation: string; book: string; chapter: number; verse: number | null };

function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function' && 'userChoice' in event;
}

function connectionLabel(isOnline: boolean | null): string {
  if (isOnline === null) return 'Checking connection';
  if (isOnline) return 'You’re online';
  return 'You’re offline';
}

/** Parses the client-local hub hash so offline navigation needs no RSC request. */
function parseHash(hash: string): HubView {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'book' && parts[1]) {
    const page = Number.parseInt(parts[2] ?? '1', 10);
    return { kind: 'book', bookId: parts[1], page: Number.isFinite(page) && page > 0 ? page : 1 };
  }
  if (parts[0] === 'bible' && parts[1] && parts[2] && parts[3]) {
    const chapter = Number.parseInt(parts[3], 10);
    const verse = parts[4] ? Number.parseInt(parts[4].replace(/^v/, ''), 10) : null;
    return {
      kind: 'bible',
      translation: parts[1],
      book: parts[2],
      chapter: Number.isFinite(chapter) ? chapter : 1,
      verse: verse !== null && Number.isFinite(verse) ? verse : null,
    };
  }
  return { kind: 'list' };
}

function bookHref(bookId: string, page: number): string {
  return `#book/${bookId}/${page}`;
}

function bibleHref(translation: string, book: string, chapter: number, verse?: number): string {
  return `#bible/${translation}/${book}/${chapter}${verse ? `/v${verse}` : ''}`;
}

function describeDownload(download: DownloadManifestRecord): string {
  if (download.kind === 'BOOK') return `Book · v${download.activeVersion ?? download.contentVersion}`;
  const [translation, book, chapter] = download.contentId.split(':');
  return `${getBookName(book)} ${chapter} · ${translation}`;
}

/**
 * One saved book read client-locally. The repository opens the pinned version
 * without any session/network call, and PageCanvas disposes each Blob URL as
 * pages change or the view unmounts.
 */
function OfflineBookReader({ bookId, page, onPageChange }: {
  readonly bookId: string;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}) {
  const [opened, setOpened] = useState<OpenedBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const repository = new BookRepository({
      database: new OfflineDatabase(),
      getOwner: () => accountLifecycle().getOwner(),
    });
    repository
      .open(bookId, undefined, { localOnly: true })
      .then((result) => {
        if (!cancelled) setOpened(result);
      })
      .catch(() => {
        if (!cancelled) setError('This download is incomplete or no longer available.');
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (error) {
    return (
      <p role="alert" className="p-8 text-center text-error">
        {error}
      </p>
    );
  }
  if (!opened) return <LoadingSpinner />;

  return (
    <OfflineBookSurface
      key={bookId}
      opened={opened}
      page={page}
      onPageChange={onPageChange}
    />
  );
}

function OfflineBookSurface({ opened, page, onPageChange }: {
  readonly opened: OpenedBook;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}) {
  const clampedPage = Math.min(Math.max(page, 1), opened.pageCount || 1);
  const [items, setItems] = useState<PdfTextItem[] | null>(null);
  const [frame, setFrame] = useState<FrameHandle | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    opened.openPage(clampedPage).then(
      (result) => {
        if (cancelled) {
          result.frame.dispose();
          return;
        }
        setFrame(result.frame);
        setItems(result.items);
      },
      () => {
        if (!cancelled) setError('This page could not be opened from the saved download.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [opened, clampedPage]);

  if (error) {
    return (
      <p role="alert" className="p-8 text-center text-error">
        {error}
      </p>
    );
  }
  if (!frame) return <LoadingSpinner />;

  return (
    <div className="min-h-dvh bg-paper">
      <BookReaderView
        title={opened.title}
        page={clampedPage}
        pageCount={opened.pageCount}
        items={items}
        frame={frame}
        capabilities={opened.capabilities}
        onPageChange={(next) => onPageChange(Math.min(Math.max(next, 1), opened.pageCount || 1))}
        onBack={() => globalThis.window.location.hash = ''}
        statusNotice="Saved offline · read without a connection"
      />
    </div>
  );
}

/**
 * One saved Bible chapter read client-locally from the Task 6 records. No
 * network request is made; audio, search, enrichment, and realtime are
 * reported unavailable rather than silently appearing functional.
 */
function OfflineBibleReader({ translation, book, chapter, verse }: {
  readonly translation: string;
  readonly book: string;
  readonly chapter: number;
  readonly verse: number | null;
}) {
  const [opened, setOpened] = useState<OpenedChapter | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const repository = new BibleRepository({
      database: new OfflineDatabase(),
      getOwner: () => accountLifecycle().getOwner(),
    });
    repository
      .openChapter(translation, book, chapter)
      .then((result) => {
        if (!cancelled) setOpened(result);
      })
      .catch(() => {
        if (!cancelled) setError('This chapter has not been saved for offline reading.');
      });
    return () => {
      cancelled = true;
    };
  }, [translation, book, chapter]);

  const books = useMemo<TranslationBook[]>(() => (opened ? [opened.bookMeta] : []), [opened]);

  const navigate = useCallback((href: string) => {
    // Chapter links are `/bible/{t}/{b}/{c}`; rewrite to the client-local hash.
    const parts = href.split('#')[0].split('?')[0].split('/').filter(Boolean);
    if (parts[0] === 'bible' && parts[1] && parts[2] && parts[3]) {
      globalThis.window.location.hash = bibleHref(parts[1], parts[2], Number(parts[3]));
    }
  }, []);

  if (error) {
    return (
      <p role="alert" className="p-8 text-center text-error">
        {error}
      </p>
    );
  }
  if (!opened) return <LoadingSpinner />;

  return (
    <BibleReaderView
      translation={opened.translation}
      bookId={opened.book}
      chapter={opened.chapter}
      book={opened.bookMeta}
      translationMeta={opened.translationMeta}
      content={opened.chapterContent.content}
      footnotes={opened.chapterContent.footnotes}
      books={books}
      capabilities={opened.capabilities}
      initialVerse={verse}
      attribution={opened.attribution}
      onNavigate={navigate}
      onBack={() => globalThis.window.location.hash = ''}
    />
  );
}

/**
 * Mounts a saved reader only after account ownership has been restored. A cold
 * deep-link renders the book/Bible view from the URL hash immediately, but the
 * persisted owner resolves asynchronously. Opening the local repository before
 * that resolution rejects and leaves a permanent "download unavailable" error,
 * so readers stay gated on the existing hydration state and fail closed when
 * restoration ends signed out or rejects.
 */
function OfflineReaderGate({
  restoration,
  children,
}: {
  readonly restoration: 'pending' | 'ready' | 'signed-out' | 'failed';
  readonly children: ReactNode;
}) {
  if (restoration === 'ready') return children;
  if (restoration === 'pending') {
    return (
      <main className="min-h-dvh bg-paper">
        <div role="status" aria-live="polite">
          <LoadingSpinner />
          <span className="sr-only">Loading saved reading</span>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-dvh bg-paper">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl items-center justify-center px-5 py-8 sm:px-8">
        <p className="max-w-sm rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-center font-body text-body text-on-surface-variant">
          Sign in while online to save reading for offline use.
        </p>
      </div>
    </main>
  );
}

/** Chooses between the loading, saved-library, and signed-out states. */
function OfflineLibrarySection({
  loading,
  owner,
  downloads,
}: {
  readonly loading: boolean;
  readonly owner: string | null;
  readonly downloads: readonly DownloadManifestRecord[];
}) {
  if (loading) return <LoadingSpinner />;
  if (!owner) {
    return (
      <p className="font-small text-sm leading-relaxed text-on-surface-variant">
        Sign in while online to save reading for offline use.
      </p>
    );
  }
  return <OfflineLibrary downloads={downloads} />;
}

/** Lists saved books and chapters; opening is purely client-local. */
function OfflineLibrary({ downloads }: { readonly downloads: readonly DownloadManifestRecord[] }) {
  if (downloads.length === 0) {
    return (
      <p className="rounded-xl border border-outline-variant bg-surface-container-low p-6 text-center font-body text-body text-on-surface-variant">
        Nothing is saved for offline reading yet. Save a book or Bible chapter while online, then it will appear here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {downloads.map((download) => {
        const parts = download.contentId.split(':');
        const href = download.kind === 'BOOK'
          ? bookHref(download.contentId, 1)
          : bibleHref(parts[0], parts[1], Number(parts[2]));
        return (
          <li key={download.id}>
            <a
              href={href}
              className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="font-display text-small font-bold text-on-surface">
                {download.kind === 'BOOK' ? download.contentId : download.contentId.replaceAll(':', ' ')}
              </span>
              <span className="font-micro text-micro text-on-surface-variant">{describeDownload(download)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export default function OfflineClient() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState('Use your browser menu to add this page to your home screen.');
  const [view, setView] = useState<HubView>({ kind: 'list' });
  const [owner, setOwner] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadManifestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoration, setRestoration] = useState<'pending' | 'ready' | 'signed-out' | 'failed'>('pending');

  useEffect(() => {
    const browser = globalThis.window;
    setIsOnline(browser.navigator.onLine);
    setView(parseHash(browser.location.hash));

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleInstallAvailable = (event: Event) => {
      if (!isInstallPromptEvent(event)) return;
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleHashChange = () => setView(parseHash(browser.location.hash));

    browser.addEventListener('online', handleOnline);
    browser.addEventListener('offline', handleOffline);
    browser.addEventListener('beforeinstallprompt', handleInstallAvailable);
    browser.addEventListener('hashchange', handleHashChange);

    return () => {
      browser.removeEventListener('online', handleOnline);
      browser.removeEventListener('offline', handleOffline);
      browser.removeEventListener('beforeinstallprompt', handleInstallAvailable);
      browser.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Restore the persisted local owner and enumerate saved content. This is a
  // client-local IndexedDB read: it must not depend on any (uncached) RSC
  // transition or network request.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await hydrateAccountLifecycle();
        const current = accountLifecycle().getOwner();
        if (!current) {
          if (!cancelled) {
            setOwner(null);
            setDownloads([]);
            setRestoration('signed-out');
          }
          return;
        }
        const records = await new OfflineDatabase().listDownloadManifests(current.subject);
        if (cancelled) return;
        setOwner(current.subject);
        setDownloads(
          records
            .filter((record) => record.status === 'READY' && record.activeVersion !== null)
            .sort((a, b) => a.contentId.localeCompare(b.contentId)),
        );
        setRestoration('ready');
      } catch {
        if (!cancelled) {
          setDownloads([]);
          setRestoration('failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallMessage(choice.outcome === 'accepted'
      ? 'Transform Lit was added to your home screen.'
      : 'No problem. You can install Transform Lit later from your browser menu.');
    setInstallPrompt(null);
  }, [installPrompt]);

  const statusLabel = connectionLabel(isOnline);

  if (view.kind === 'book') {
    return (
      <OfflineReaderGate restoration={restoration}>
        <main className="min-h-dvh bg-paper">
          <OfflineBookReader
            bookId={view.bookId}
            page={view.page}
            onPageChange={(page) => {
              globalThis.window.location.hash = bookHref(view.bookId, page);
            }}
          />
        </main>
      </OfflineReaderGate>
    );
  }

  if (view.kind === 'bible') {
    return (
      <OfflineReaderGate restoration={restoration}>
        <main className="min-h-dvh bg-paper">
          <OfflineBibleReader translation={view.translation} book={view.book} chapter={view.chapter} verse={view.verse} />
        </main>
      </OfflineReaderGate>
    );
  }

  return (
    <main className="min-h-dvh px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="inline-flex min-h-11 items-center gap-3 rounded-lg text-on-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-primary text-on-primary shadow-sm">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6.5c-2.2-1.7-5-2-8-1.2v12.2c3-.8 5.8-.5 8 1.2 2.2-1.7 5-2 8-1.2V5.3c-3-.8-5.8-.5-8 1.2Z" />
                <path d="M12 6.5v12.2" />
              </svg>
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">Transform Lit</span>
          </a>
          <span aria-live="polite" role="status" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 font-small text-sm font-medium text-on-surface">
            <span aria-hidden="true" className={`size-2 rounded-full ${isOnline === false ? 'bg-outline' : 'bg-secondary'}`} />
            {statusLabel}
          </span>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 md:grid-cols-[1.05fr_0.95fr] md:gap-16 md:py-20">
          <div className="max-w-xl">
            <p className="mb-5 font-small text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant">A quieter place to return to</p>
            <h1 className="max-w-lg font-display text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-on-surface sm:text-5xl md:text-6xl">
              A little room to read offline
            </h1>
            <p className="mt-6 max-w-prose font-body text-xl leading-relaxed text-on-surface-variant sm:text-2xl">
              Take a breath. Your saved books and Bible chapters open right here, even without a connection.
            </p>
            <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {installPrompt ? (
                <button type="button" onClick={handleInstall} className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-6 py-3 font-small text-sm font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transition-none">
                  Install Transform Lit
                </button>
              ) : (
                <p className="max-w-sm rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 font-small text-sm leading-relaxed text-on-surface-variant">
                  {installMessage}
                </p>
              )}
              <a href="/" className="inline-flex min-h-11 items-center justify-center rounded-full px-5 py-3 font-small text-sm font-semibold text-primary underline decoration-primary/50 underline-offset-4 transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary motion-reduce:transition-none">
                Return to Transform Lit
              </a>
            </div>
          </div>

          <aside aria-label="Saved for offline reading" className="relative mx-auto w-full max-w-md md:justify-self-end">
            <div aria-hidden="true" className="absolute -right-4 -top-5 size-24 rounded-full bg-primary-fixed/70 blur-2xl sm:-right-8 sm:-top-8 sm:size-40" />
            <div className="relative overflow-hidden rounded-[2rem] border border-outline-variant/80 bg-surface-container-low p-6 shadow-[0_24px_70px_-36px_rgba(56,38,19,0.42)] sm:p-8">
              <div className="flex items-start justify-between">
                <span className="font-small text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant">Saved for offline</span>
                <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-primary-fixed text-on-primary-fixed">
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 4.5h10a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3v-12Z" />
                    <path d="M8 19.5a3 3 0 0 1 0-6h10M9 8h5M9 11h3" />
                  </svg>
                </span>
              </div>
              <div className="my-6 h-px bg-outline-variant" />
              <OfflineLibrarySection loading={loading} owner={owner} downloads={downloads} />
            </div>
          </aside>
        </section>

        <footer className="flex flex-col gap-2 border-t border-outline-variant/70 py-5 font-small text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
          <span>Transform Lit · Read with purpose.</span>
          <span>Offline reading is limited to content you save on this device.</span>
        </footer>
      </div>
    </main>
  );
}
