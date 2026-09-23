'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

  // #v{n} deep link — scroll AFTER content mounts (hash alone can't target async content)
  useEffect(() => {
    if (!data) return;
    const m = /^#v(\d+)$/.exec(globalThis.window.location.hash);
    if (!m) return;
    const verse = Number(m[1]);
    const el = document.getElementById(`v${verse}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlighted(verse);
      const timer = setTimeout(() => setHighlighted(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [data, book, chapter]);

  const navigate = useCallback(
    (href: string) => {
      router.replace(href);
    },
    [router],
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
      />
    </>
  );
}
