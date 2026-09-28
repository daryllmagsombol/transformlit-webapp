'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChapter } from '../../../../../../lib/hooks/use-chapter';
import { useBibleBooks } from '../../../../../../lib/hooks/use-bible-books';
import { useRequireAuth } from '../../../../../../lib/hooks/use-require-auth';
import { useBibleStore } from '../../../../../../store/bible-store';
import {
  VerseList,
  StudySheet,
  AudioPlayer,
  ChapterNav,
  BookChapterPicker,
} from '../../../../../../components/bible';
import { LoadingSpinner } from '../../../../../../components/ui';
import { flattenVerseText } from '../../../../../../lib/bible/words';
import { formatRef, nextChapter, prevChapter, refToHref } from '../../../../../../lib/bible/refs';
import { getBookName } from '../../../../../../lib/bible/config';
import type { ChapterFootnote, ChapterWord } from '../../../../../../lib/bible/types';

interface ReaderProps {
  readonly translation: string;
  readonly book: string;
  readonly chapter: number;
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

export default function BibleReaderClient({ translation, book, chapter }: ReaderProps) {
  const router = useRouter();
  const { isReady } = useRequireAuth();
  const { chapter: data, words, loading, error } = useChapter(translation, book, chapter);
  const { books } = useBibleBooks(translation);

  const [studyVerse, setStudyVerse] = useState<number | null>(null);
  const [studyFootnote, setStudyFootnote] = useState<ChapterFootnote | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeWord, setActiveWord] = useState<{ verse: number; word: ChapterWord } | null>(null);

  const setLastPosition = useBibleStore((s) => s.setLastPosition);

  useEffect(() => {
    setLastPosition(translation, { book, chapter });
  }, [translation, book, chapter, setLastPosition]);

  // Reset sheet state on chapter change (App Router preserves the component instance
  // across router.replace hops within the same dynamic route)
  useEffect(() => {
    setStudyVerse(null);
    setStudyFootnote(null);
    setActiveWord(null);
    setHighlighted(null);
  }, [translation, book, chapter]);

  // In-flight deep-link retry frame and highlight timer, kept in refs so the
  // bounded rAF loop can be cancelled from any caller (navigate, hashchange,
  // unmount, chapter change) and so `scrollToVerse` stays referentially stable.
  const frameRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A cross-chapter deep link must wait until the target chapter's verse nodes
  // exist. Stored here and consumed by the data-arrival effect below, because
  // the bounded rAF retry alone can exhaust before the async fetch resolves.
  // The target route is kept alongside the verse so a later, unrelated chapter
  // load can never consume a stale pending verse.
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

  // #v{n} deep link — scroll AFTER content mounts.
  //
  // Ordering dependency: ScrollToTop (components/layout/scroll-to-top.tsx)
  // scrolls to top on every pathname change, but this reader's chapter data
  // arrives asynchronously AFTER that. The bounded rAF retry is what lets the
  // deep-link scroll win that race. Do not remove the retry or run it before
  // the content is painted, or the race is reintroduced.
  //
  // In-app navigation does NOT rely on this listener: Next.js App Router drives
  // client navigation with history.pushState/replaceState, which do NOT emit
  // `hashchange` (see next/dist/client/components/app-router.js). So `navigate`
  // below parses the target href and calls `scrollToVerse` directly. The
  // `hashchange` listener is a defensive extra that only fires for manual
  // URL-bar hash edits, real anchor clicks, and browser back/forward. Do not
  // "simplify" this back to a hashchange-only solution — that breaks
  // cross-references pointing at the current chapter.
  useEffect(() => {
    if (!data) return;

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
  }, [data, book, chapter, scrollToVerse, cancelPendingScroll, clearHighlightTimer]);

  // Consume a pending deep-link once the matching chapter content has mounted.
  // A cross-chapter navigation refetches and temporarily unmounts the verse DOM,
  // so the bounded rAF loop in `scrollToVerse` can exhaust before the data
  // resolves. Waiting for `data` to match the current route guarantees the verse
  // node exists before we scroll, regardless of fetch latency.
  useEffect(() => {
    if (!data) return;
    if (data.book.id !== book || data.chapter.number !== chapter) return;
    const pending = pendingVerseRef.current;
    if (pending === null || pending.book !== book || pending.chapter !== chapter) return;
    pendingVerseRef.current = null;
    scrollToVerse(pending.verse);
  }, [data, book, chapter, scrollToVerse]);

  const navigate = useCallback(
    (href: string) => {
      const verse = verseFromHash(href);
      const target = routeFromHref(href);
      const sameChapter =
        target !== null && target.book === book && target.chapter === chapter;

      if (verse !== null && target !== null && !sameChapter) {
        // Cross-chapter: defer to the data-arrival effect so we never scroll the
        // outgoing chapter's DOM (the target verse id may also exist there).
        pendingVerseRef.current = { book: target.book, chapter: target.chapter, verse };
      }

      router.replace(href);

      // pushState/replaceState do not fire `hashchange`, so scroll directly when
      // the DOM is not about to be swapped (same chapter or an unrecognized href).
      if (verse !== null && (sameChapter || target === null)) scrollToVerse(verse);
    },
    [router, scrollToVerse, book, chapter],
  );

  const openStudyForVerse = useCallback((verse: number) => {
    setStudyFootnote(null);
    setActiveWord(null);
    setStudyVerse(verse);
  }, []);

  const handleFootnote = useCallback(
    (note: ChapterFootnote) => {
      const real = data?.chapter.footnotes.find((f) => f.noteId === note.noteId) ?? null;
      setStudyVerse(null);
      setActiveWord(null);
      setStudyFootnote(real);
    },
    [data],
  );

  const handleWord = useCallback((verse: number, word: ChapterWord) => {
    setStudyFootnote(null);
    setStudyVerse(verse);
    setActiveWord({ verse, word });
  }, []);

  const prev = useMemo(() => {
    if (!books.length) return null;
    const ref = prevChapter(books, book, chapter);
    return ref ? { href: refToHref(translation, ref.book.id, ref.chapter), label: formatRef(ref.book, ref.chapter) } : null;
  }, [books, book, chapter, translation]);

  const next = useMemo(() => {
    if (!books.length) return null;
    const ref = nextChapter(books, book, chapter);
    return ref ? { href: refToHref(translation, ref.book.id, ref.chapter), label: formatRef(ref.book, ref.chapter) } : null;
  }, [books, book, chapter, translation]);

  const studyVerseText =
    studyVerse !== null && data
      ? (data.chapter.content.find((c) => c.type === 'verse' && c.number === studyVerse) as
          | Extract<typeof data.chapter.content[number], { type: 'verse' }>
          | undefined)?.content
      : null;

  const wordsForVerse =
    studyVerse !== null && words?.verses?.[String(studyVerse)]
      ? words.verses[String(studyVerse)]
      : [];

  const activeWordText = useMemo(() => {
    if (!activeWord || !data) return '';
    const verseItem = data.chapter.content.find(
      (c) => c.type === 'verse' && c.number === activeWord.verse,
    ) as Extract<typeof data.chapter.content[number], { type: 'verse' }> | undefined;
    if (!verseItem) return '';
    const piece = verseItem.content[activeWord.word.contentIndex];
    if (typeof piece === 'string') return piece.slice(activeWord.word.start, activeWord.word.end);
    if (piece && 'text' in piece && typeof piece.text === 'string') {
      return piece.text.slice(activeWord.word.start, activeWord.word.end);
    }
    return '';
  }, [activeWord, data]);

  if (loading || !isReady) return <LoadingSpinner />;
  if (error || !data) {
    return <p className="text-error text-center py-12">Failed to load this chapter.</p>;
  }

  return (
    <>
      {/* Sticky toolbar */}
      <div className="sticky top-16 z-40 bg-surface/95 dark:bg-surface-dark/95 backdrop-blur border-b border-outline-variant">
        <div className="flex items-center justify-between px-1 py-2">
          <button
            type="button"
            onClick={() => router.push('/bible')}
            className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors"
            aria-label="Back to library"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="text-center">
            <p className="font-display text-headline-h4 font-bold text-on-surface">
              {formatRef(data.book, chapter)}
            </p>
            <p className="font-micro text-micro text-on-surface-variant">{data.translation.name}</p>
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
        <VerseList
          content={data.chapter.content}
          footnotes={data.chapter.footnotes}
          words={words ?? undefined}
          selectedVerse={studyVerse}
          highlightedVerse={highlighted}
          activeWord={activeWord}
          onVerseClick={openStudyForVerse}
          onFootnoteClick={handleFootnote}
          onWordClick={handleWord}
        />

        {data.thisChapterAudioLinks && Object.keys(data.thisChapterAudioLinks).length > 0 && (
          <div className="mt-8">
            <AudioPlayer
              links={data.thisChapterAudioLinks}
              onEnded={() => {
                if (next) navigate(next.href);
              }}
            />
          </div>
        )}

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
          studyFootnote ? [studyFootnote] : data.chapter.footnotes.filter((f) =>
            studyVerseText?.some(
              (piece) =>
                typeof piece === 'object' && piece !== null && 'noteId' in piece && piece.noteId === f.noteId,
            ),
          )
        }
        wordsForVerse={wordsForVerse}
        translation={translation}
        book={book}
        chapter={chapter}
        bookName={getBookName(book)}
        onNavigate={navigate}
        activeWord={activeWord?.word ?? null}
        activeWordText={activeWordText}
      />

      <BookChapterPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        books={books}
        translation={translation}
        bookId={book}
        chapter={chapter}
        onNavigate={navigate}
      />
    </>
  );
}
