'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Modal } from '../ui/modal';
import { LoadingSpinner } from '../ui/loading-spinner';
import { getChapter } from '../../lib/bible/api';
import { isOldTestament, refToHref } from '../../lib/bible/refs';
import type { TranslationBook } from '../../lib/bible/types';

interface BookChapterPickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly books: TranslationBook[];
  readonly translation: string;
  readonly bookId?: string;
  readonly chapter?: number;
  /**
   * Optional host navigation. When provided, chapter/verse links route through
   * it instead of a plain `<Link>` push. The reader needs this because a
   * same-chapter `#v{n}` change is a pushState navigation that emits no
   * `hashchange`, so the host must scroll the target verse itself.
   */
  readonly onNavigate?: (href: string) => void;
}

function isChapterInBook(book: TranslationBook, chapter: number): boolean {
  return chapter >= 1 && chapter <= book.numberOfChapters;
}

function resolveInitialChapter(book: TranslationBook | undefined, chapter: number | undefined): number | null {
  if (!book) return null;
  if (chapter !== undefined && isChapterInBook(book, chapter)) return chapter;
  return book.firstChapterNumber;
}

function bookButtonClass(isActive: boolean): string {
  const base = 'w-full text-left px-3 py-2 rounded text-small font-display';
  if (isActive) {
    return `${base} bg-primary-container/25 border-l-[3px] border-primary text-on-surface font-bold`;
  }
  return `${base} text-on-surface-variant hover:bg-surface-container-high`;
}

function chapterCellClass(isCurrent: boolean, isSelected: boolean): string {
  const base =
    'inline-flex items-center justify-center h-11 rounded text-small font-display border transition-colors';
  if (isCurrent) return `${base} bg-brand-orange-dark text-on-primary border-brand-orange-dark`;
  if (isSelected) return `${base} border-primary bg-primary-container/25 text-on-surface font-bold`;
  return `${base} border-outline-variant text-on-surface-variant hover:border-primary`;
}

export function BookChapterPicker({
  open,
  onClose,
  books,
  translation,
  bookId,
  chapter,
  onNavigate,
}: BookChapterPickerProps) {
  const bookRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const requestedBook = books.find((b) => b.id === bookId);
  const initialBook = requestedBook ?? books[0];
  const [selectedBookId, setSelectedBookId] = useState(initialBook?.id ?? '');
  const [selectedChapter, setSelectedChapter] = useState<number | null>(() =>
    resolveInitialChapter(initialBook, requestedBook ? chapter : undefined),
  );
  const [verseCount, setVerseCount] = useState<number | null>(null);
  const [verseLoading, setVerseLoading] = useState(false);
  const [verseError, setVerseError] = useState(false);
  const [verseRetry, setVerseRetry] = useState(0);

  // Re-sync the selection whenever the picker opens (or the route book/chapter changes).
  useEffect(() => {
    if (!open) return;
    const routeBook = books.find((b) => b.id === bookId);
    const targetBook = routeBook ?? books[0];
    if (!targetBook) {
      setSelectedChapter(null);
      return;
    }
    const routeChapter = routeBook ? chapter : undefined;
    setSelectedBookId(targetBook.id);
    setSelectedChapter(resolveInitialChapter(targetBook, routeChapter));
  }, [open, bookId, chapter, books]);

  useEffect(() => {
    if (open) {
      const el = bookRefs.current.get(selectedBookId);
      el?.scrollIntoView({ block: 'center' });
    }
  }, [open, selectedBookId]);

  // Verse count for the selected chapter — ETag-cached, so repeat selections are cheap.
  useEffect(() => {
    if (!open || selectedChapter === null || !selectedBookId) {
      setVerseCount(null);
      setVerseError(false);
      setVerseLoading(false);
      return;
    }
    let cancelled = false;
    setVerseCount(null);
    setVerseError(false);
    setVerseLoading(true);
    getChapter(translation, selectedBookId, selectedChapter)
      .then((data) => {
        if (!cancelled) setVerseCount(data.numberOfVerses);
      })
      .catch(() => {
        if (!cancelled) setVerseError(true);
      })
      .finally(() => {
        if (!cancelled) setVerseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, translation, selectedBookId, selectedChapter, verseRetry]);

  const current = books.find((b) => b.id === selectedBookId);
  const chapterCount = current?.numberOfChapters ?? 0;
  const selectedBookName = current?.commonName ?? bookId ?? '';

  const handleSelectBook = (book: TranslationBook) => {
    setSelectedBookId(book.id);
    setSelectedChapter(book.firstChapterNumber);
  };

  return (
    <Modal open={open} onClose={onClose} title="Choose a Chapter">
      <div className="grid grid-cols-[2fr_3fr] gap-4">
        <div className="max-h-[50dvh] overflow-y-auto custom-scrollbar flex flex-col">
          {(['Old Testament', 'New Testament'] as const).map((label) => {
            const list = books.filter((b) => (label === 'Old Testament' ? isOldTestament(b) : !isOldTestament(b)));
            return (
              <div key={label}>
                <p className="font-micro text-micro uppercase tracking-[0.2em] text-on-surface-variant sticky top-0 bg-surface py-1">
                  {label}
                </p>
                {list.map((b) => (
                  <button
                    key={b.id}
                    ref={(el) => {
                      bookRefs.current.set(b.id, el);
                    }}
                    type="button"
                    onClick={() => handleSelectBook(b)}
                    className={bookButtonClass(b.id === selectedBookId)}
                  >
                    {b.commonName}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="font-display text-headline-h4 text-on-surface">
              <span>{selectedBookName}</span>
              {selectedChapter !== null && (
                <span className="ml-2 text-on-surface-variant">Chapter {selectedChapter}</span>
              )}
            </p>
            {selectedChapter !== null && (
              <Link
                href={refToHref(translation, selectedBookId, selectedChapter)}
                onClick={(e) => {
                  if (onNavigate) e.preventDefault();
                  onClose();
                  onNavigate?.(refToHref(translation, selectedBookId, selectedChapter));
                }}
                className="shrink-0 px-3 py-1.5 rounded-full border border-outline-variant text-small font-display text-on-surface hover:border-primary transition-colors"
              >
                Open chapter
              </Link>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2" data-testid="chapter-grid">
            {Array.from({ length: chapterCount }, (_, i) => i + 1).map((c) => (
              <Link
                key={c}
                href={refToHref(translation, selectedBookId, c)}
                onClick={(e) => {
                  // Keep the chapter href (deep-linkable / new-tab), but selecting a
                  // chapter browses its verses instead of navigating away immediately.
                  e.preventDefault();
                  setSelectedChapter(c);
                }}
                aria-current={selectedBookId === bookId && c === chapter ? 'true' : undefined}
                className={chapterCellClass(selectedBookId === bookId && c === chapter, c === selectedChapter)}
              >
                {c}
              </Link>
            ))}
          </div>

          {selectedChapter !== null && (
            <div className="mt-4">
              <p className="font-micro text-micro uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                Verses
              </p>

              {verseLoading && (
                <LoadingSpinner fullScreen={false} showLabel={false} className="py-4" />
              )}

              {verseError && (
                <div className="flex items-center gap-3 py-2">
                  <p className="text-small text-on-surface-variant">Could not load verses.</p>
                  <button
                    type="button"
                    onClick={() => setVerseRetry((n) => n + 1)}
                    className="text-small font-display text-primary hover:underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {!verseLoading && !verseError && (
                <div className="grid grid-cols-4 gap-2" data-testid="verse-grid">
                  {Array.from({ length: verseCount ?? 0 }, (_, i) => i + 1).map((v) => (
                    <Link
                      key={v}
                      href={refToHref(translation, selectedBookId, selectedChapter, v)}
                      onClick={(e) => {
                        // Same-chapter `#v{n}` via pushState emits no `hashchange`,
                        // so hand off to the host navigator which scrolls directly.
                        if (onNavigate) e.preventDefault();
                        onClose();
                        onNavigate?.(refToHref(translation, selectedBookId, selectedChapter, v));
                      }}
                      className="inline-flex items-center justify-center h-11 rounded text-small font-display border border-outline-variant text-on-surface-variant hover:border-primary transition-colors"
                    >
                      {v}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
