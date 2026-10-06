'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VerseList } from './verse-list';
import { StudySheet } from './study-sheet';
import { AudioPlayer } from './audio-player';
import { ChapterNav, type NavLink } from './chapter-nav';
import { BookChapterPicker } from './book-chapter-picker';
import { flattenVerseText } from '../../lib/bible/words';
import { formatRef, nextChapter, prevChapter, refToHref } from '../../lib/bible/refs';
import { getBookName } from '../../lib/bible/config';
import type { BibleCapabilities } from '../../lib/bible/repository';
import type {
  ChapterContent,
  ChapterFootnote,
  ChapterWord,
  ChapterWords,
  TranslationBook,
} from '../../lib/bible/types';

export interface BibleReaderViewProps {
  readonly translation: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly book: TranslationBook;
  readonly translationMeta: { id: string; name: string; shortName: string };
  readonly content: ChapterContent[];
  readonly footnotes: ChapterFootnote[];
  readonly words?: ChapterWords | null;
  readonly audioLinks?: Record<string, string> | null;
  /** Full book list for the picker and prev/next; a single-book list works too. */
  readonly books?: TranslationBook[];
  readonly capabilities: BibleCapabilities;
  readonly onNavigate: (href: string) => void;
  readonly onBack: () => void;
  /**
   * Optional verse to scroll to/highlight on mount. Used by the offline hub,
   * whose hash is route-shaped rather than `#v{n}`. Online readers leave this
   * undefined and rely on the URL hash.
   */
  readonly initialVerse?: number | null;
  /**
   * Required translation attribution (e.g. from a downloaded chapter's stored
   * rights record). Rendered so a redistribution/offline-storage grant is
   * visible to the reader; omitted when no attribution was recorded.
   */
  readonly attribution?: string | null;
  /** Download control slot, rendered above the verse list. */
  readonly downloadControls?: ReactNode;
}

/**
 * Bounded rAF retry budget (~1s at 60fps). The verse node may not be painted
 * or measurable the instant chapter data arrives (fonts, subtitles, audio, and
 * chapter nav all shift layout afterwards).
 */
const DEEP_LINK_MAX_ATTEMPTS = 60;

/**
 * Extract a verse number from a `#v{n}` hash or href tail (the contract emitted
 * by `refToHref` in lib/bible/refs.ts). Returns null for any non-matching hash;
 * never throws and never falls back to scroll-to-top.
 */
function verseFromHash(hashOrHref: string): number | null {
  const m = /#v(\d+)$/.exec(hashOrHref);
  return m ? Number(m[1]) : null;
}

/**
 * Extract the book and chapter from a `/bible/{translation}/{book}/{chapter}`
 * href (optionally with a `#v{n}` or `?query` tail). Returns null if the href
 * does not match the reader route shape.
 */
function routeFromHref(href: string): { book: string; chapter: number } | null {
  const path = href.split('#')[0].split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 4 || parts[0] !== 'bible') return null;
  const parsedChapter = Number(parts[3]);
  if (!Number.isInteger(parsedChapter)) return null;
  return { book: parts[2], chapter: parsedChapter };
}

/**
 * Deep-link scroll + highlight shared by the online reader and the offline hub.
 * It owns the bounded rAF retry, the pending cross-chapter verse, and the
 * highlight timer, while delegating the actual route change to `navigate`.
 */
function useVerseDeepLink(
  book: string,
  chapter: number,
  contentReady: boolean,
  navigate: (href: string) => void,
) {
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVerseRef = useRef<{ book: string; chapter: number; verse: number } | null>(null);

  const clearHighlightTimer = useCallback(() => {
    if (highlightTimerRef.current !== null) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  const cancelPendingScroll = useCallback(() => {
    if (frameRef.current !== null) {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  // Scroll to #v{n}, retrying until the verse node exists (chapter content can
  // mount asynchronously). Bounded by DEEP_LINK_MAX_ATTEMPTS (~1s) — never an
  // unbounded interval. Any prior in-flight retry is cancelled first.
  const scrollToVerse = useCallback(
    (verse: number) => {
      cancelPendingScroll();
      let attempts = 0;

      const attemptScroll = () => {
        const el = document.getElementById(`v${verse}`);
        if (!el) {
          if (attempts < DEEP_LINK_MAX_ATTEMPTS) {
            attempts += 1;
            frameRef.current = globalThis.requestAnimationFrame(attemptScroll);
          }
          return;
        }
        frameRef.current = null;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearHighlightTimer();
        setHighlighted(verse);
        highlightTimerRef.current = setTimeout(() => {
          highlightTimerRef.current = null;
          setHighlighted(null);
        }, 2000);
      };

      attemptScroll();
    },
    [cancelPendingScroll, clearHighlightTimer],
  );

  const requestNavigate = useCallback(
    (href: string) => {
      const verse = verseFromHash(href);
      const target = routeFromHref(href);
      const sameChapter = target !== null && target.book === book && target.chapter === chapter;

      if (verse !== null && target !== null && !sameChapter) {
        // Cross-chapter: defer to the data-arrival effect so we never scroll the
        // outgoing chapter's DOM (the target verse id may also exist there).
        pendingVerseRef.current = { book: target.book, chapter: target.chapter, verse };
      }

      navigate(href);

      // pushState/replaceState do not fire `hashchange`, so scroll directly when
      // the DOM is not about to be swapped (same chapter or an unrecognized href).
      if (verse !== null && (sameChapter || target === null)) scrollToVerse(verse);
    },
    [navigate, scrollToVerse, book, chapter],
  );

  // #v{n} deep link — scroll AFTER content mounts. In-app navigation does NOT
  // rely on this listener: Next.js App Router drives client navigation with
  // history.pushState/replaceState, which do NOT emit `hashchange`. The
  // listener is a defensive extra for manual URL-bar edits, real anchor clicks,
  // and browser back/forward.
  useEffect(() => {
    if (!contentReady) return;

    const scrollFromCurrentHash = () => {
      const verse = verseFromHash(globalThis.window.location.hash);
      if (verse !== null) scrollToVerse(verse);
    };

    scrollFromCurrentHash();
    globalThis.window.addEventListener('hashchange', scrollFromCurrentHash);

    return () => {
      globalThis.window.removeEventListener('hashchange', scrollFromCurrentHash);
      cancelPendingScroll();
      clearHighlightTimer();
    };
  }, [contentReady, book, chapter, scrollToVerse, cancelPendingScroll, clearHighlightTimer]);

  // Consume a pending deep-link once the matching chapter content has mounted.
  useEffect(() => {
    if (!contentReady) return;
    const pending = pendingVerseRef.current;
    if (pending === null) return;
    if (pending.book !== book || pending.chapter !== chapter) return;
    pendingVerseRef.current = null;
    scrollToVerse(pending.verse);
  }, [contentReady, book, chapter, scrollToVerse]);

  return { highlighted, navigate: requestNavigate };
}

/** Disabled, labelled notice for network-only Bible controls unavailable offline. */
function UnavailableBibleFeatures({ capabilities }: { readonly capabilities: BibleCapabilities }) {
  const unavailable: string[] = [];
  if (!capabilities.audio) unavailable.push('Audio');
  if (!capabilities.remoteSearch) unavailable.push('Search');
  if (!capabilities.enrichment) unavailable.push('Cross-references and study tools');
  if (!capabilities.realtime) unavailable.push('Live sync');
  if (unavailable.length === 0) return null;

  return (
    <p
      data-testid="bible-unavailable-features"
      role="note"
      className="mx-auto mb-4 max-w-[720px] rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2 font-small text-small text-on-surface-variant"
    >
      Unavailable offline: {unavailable.join(', ')}.
    </p>
  );
}

/**
 * The Bible reader surface shared by the online reader and the offline hub.
 * Callers resolve chapter content (network via `useChapter`, local via
 * `BibleRepository`) and supply capabilities; this view renders the toolbar,
 * verse list, study sheet, picker, and navigation, and owns the `#v{n}`
 * deep-link scroll behavior. It never branches on storage implementation.
 */
export function BibleReaderView({
  translation,
  bookId,
  chapter,
  book,
  translationMeta,
  content,
  footnotes,
  words = null,
  audioLinks = null,
  books = [],
  capabilities,
  onNavigate,
  onBack,
  initialVerse = null,
  attribution = null,
  downloadControls = null,
}: BibleReaderViewProps) {
  const [studyVerse, setStudyVerse] = useState<number | null>(null);
  const [studyFootnote, setStudyFootnote] = useState<ChapterFootnote | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeWord, setActiveWord] = useState<{ verse: number; word: ChapterWord } | null>(null);

  const { highlighted, navigate } = useVerseDeepLink(bookId, chapter, true, onNavigate);

  // The offline hub passes an explicit verse (its hash is route-shaped), so it
  // cannot rely on the `#v{n}` hash listener. Scroll after the verse DOM mounts.
  useEffect(() => {
    if (initialVerse === null) return;
    const verse = initialVerse;
    const frame = globalThis.requestAnimationFrame(() => {
      document.getElementById(`v${verse}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [initialVerse, chapter, bookId]);

  // Reset sheet state on chapter change (App Router preserves the component
  // instance across router.replace hops within the same dynamic route).
  useEffect(() => {
    setStudyVerse(null);
    setStudyFootnote(null);
    setActiveWord(null);
  }, [translation, bookId, chapter]);

  const openStudyForVerse = useCallback((verse: number) => {
    setStudyFootnote(null);
    setActiveWord(null);
    setStudyVerse(verse);
  }, []);

  const handleFootnote = useCallback(
    (note: ChapterFootnote) => {
      const real = footnotes.find((f) => f.noteId === note.noteId) ?? null;
      setStudyVerse(null);
      setActiveWord(null);
      setStudyFootnote(real);
    },
    [footnotes],
  );

  const handleWord = useCallback((verse: number, word: ChapterWord) => {
    setStudyFootnote(null);
    setStudyVerse(verse);
    setActiveWord({ verse, word });
  }, []);

  const prev = useMemo<NavLink | null>(() => {
    if (!books.length) return null;
    const ref = prevChapter(books, bookId, chapter);
    return ref
      ? { href: refToHref(translation, ref.book.id, ref.chapter), label: formatRef(ref.book, ref.chapter) }
      : null;
  }, [books, bookId, chapter, translation]);

  const next = useMemo<NavLink | null>(() => {
    if (!books.length) return null;
    const ref = nextChapter(books, bookId, chapter);
    return ref
      ? { href: refToHref(translation, ref.book.id, ref.chapter), label: formatRef(ref.book, ref.chapter) }
      : null;
  }, [books, bookId, chapter, translation]);

  const studyVerseText = useMemo(() => {
    if (studyVerse === null) return null;
    const verse = content.find((c) => c.type === 'verse' && c.number === studyVerse);
    return verse?.type === 'verse' ? verse.content : null;
  }, [studyVerse, content]);

  const wordsForVerse = studyVerse !== null && words?.verses?.[String(studyVerse)] ? words.verses[String(studyVerse)] : [];

  const activeWordText = useMemo(() => {
    if (!activeWord) return '';
    const verseItem = content.find(
      (c) => c.type === 'verse' && c.number === activeWord.verse,
    ) as Extract<ChapterContent, { type: 'verse' }> | undefined;
    if (!verseItem) return '';
    const piece = verseItem.content[activeWord.word.contentIndex];
    if (typeof piece === 'string') return piece.slice(activeWord.word.start, activeWord.word.end);
    if (piece && 'text' in piece && typeof piece.text === 'string') {
      return piece.text.slice(activeWord.word.start, activeWord.word.end);
    }
    return '';
  }, [activeWord, content]);

  const showAudio = capabilities.audio && audioLinks && Object.keys(audioLinks).length > 0;

  return (
    <>
      {/* Sticky toolbar */}
      <div className="sticky top-16 z-40 bg-surface/95 dark:bg-surface-dark/95 backdrop-blur border-b border-outline-variant">
        <div className="flex items-center justify-between px-1 py-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors"
            aria-label="Back to library"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="text-center">
            <p className="font-display text-headline-h4 font-bold text-on-surface">
              {formatRef(book, chapter)}
            </p>
            <p className="font-micro text-micro text-on-surface-variant">{translationMeta.name}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="w-11 h-11 inline-flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
              aria-label="Choose book and chapter"
            >
              <span className="material-symbols-outlined">menu_book</span>
            </button>
          </div>
        </div>
      </div>

      {/* Chapter content */}
      <div className="max-w-[720px] mx-auto px-4 py-8">
        <UnavailableBibleFeatures capabilities={capabilities} />

        {downloadControls ? <div className="mb-6">{downloadControls}</div> : null}

        <VerseList
          content={content}
          footnotes={footnotes}
          words={words ?? undefined}
          selectedVerse={studyVerse}
          highlightedVerse={highlighted}
          activeWord={activeWord}
          onVerseClick={openStudyForVerse}
          onFootnoteClick={handleFootnote}
          onWordClick={handleWord}
        />

        {attribution ? (
          <p
            data-testid="bible-attribution"
            className="mt-6 border-t border-outline-variant pt-4 text-center font-micro text-micro text-on-surface-variant"
          >
            {attribution}
          </p>
        ) : null}

        {showAudio ? (
          <div className="mt-8">
            <AudioPlayer
              links={audioLinks}
              onEnded={() => {
                if (next) navigate(next.href);
              }}
            />
          </div>
        ) : null}

        <ChapterNav prev={prev} next={next} />
      </div>

      {/* Study sheet */}
      <StudySheet
        open={studyVerse !== null || studyFootnote !== null}
        onClose={() => {
          setStudyVerse(null);
          setStudyFootnote(null);
          setActiveWord(null);
        }}
        verse={studyVerse}
        verseText={
          studyVerseText ? flattenVerseText(studyVerseText) : studyFootnote?.text ?? ''
        }
        footnotes={
          studyFootnote
            ? [studyFootnote]
            : footnotes.filter((f) =>
                studyVerseText?.some(
                  (piece) =>
                    typeof piece === 'object' && piece !== null && 'noteId' in piece && piece.noteId === f.noteId,
                ),
              )
        }
        wordsForVerse={wordsForVerse}
        translation={translation}
        book={bookId}
        chapter={chapter}
        bookName={getBookName(bookId)}
        onNavigate={navigate}
        activeWord={activeWord?.word ?? null}
        activeWordText={activeWordText}
        crossReferencesEnabled={capabilities.enrichment}
      />

      <BookChapterPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        books={books}
        translation={translation}
        bookId={bookId}
        chapter={chapter}
        onNavigate={navigate}
      />
    </>
  );
}
