import type { TranslationBook } from './types';

/**
 * Pure route-param validation for the bible reader dynamic route
 * (`/bible/[translation]/[book]/[chapter]`).
 *
 * Kept free of `next/navigation` / `next/fetch` imports so the checks are
 * trivially unit-testable; the server page wires them to `notFound()`.
 *
 * The API path is built by string interpolation
 * (`/${translation}/${book}/${chapter}.json`), so raw route params must be
 * normalized against known-good values (curated translation id, the
 * translation's own book list, an integer chapter within the book's bounds)
 * before anything is fetched — never pass arbitrary raw input downstream.
 */

export interface ResolvedChapterRoute {
  /** Canonical curated translation id (e.g. "BSB", "eng_kjv"). */
  translation: string;
  /** Curated translation display label. */
  translationLabel: string;
  /** Canonical book id as served by the translation's books.json. */
  book: string;
  /** Display name for metadata (uses the translation's book list entry). */
  bookName: string;
  /** Validated integer chapter. */
  chapter: number;
}

/** Returns the integer chapter only for plain decimal strings ≥ 1; else null. */
export function parseChapterNumber(raw: string): number | null {
  // `/^\d+$/` (rather than Number()) rejects hex/float/scientific/blank input.
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** Case-insensitive lookup for a book id in the translation's book list. */
export function findBookById(
  books: TranslationBook[],
  rawBook: string,
): TranslationBook | undefined {
  const id = rawBook.toUpperCase();
  return books.find((b) => b.id === id);
}

/** True when `chapter` falls inside the book's served chapter range. */
export function isChapterInBook(book: TranslationBook, chapter: number): boolean {
  return chapter >= book.firstChapterNumber && chapter <= book.lastChapterNumber;
}

/**
 * Validates translation + chapter shape without I/O. Book/chapter-bounds
 * validation additionally requires the translation's book list (see the
 * server page, which resolves it via getBooks before fetching the chapter).
 */
export function resolveChapterRoute(
  translationRaw: string,
  bookRaw: string,
  chapterRaw: string,
  books: TranslationBook[],
  curated: { id: string; label: string } | undefined,
): ResolvedChapterRoute | null {
  const chapter = parseChapterNumber(chapterRaw);
  if (!curated || chapter === null) return null;
  const book = findBookById(books, bookRaw);
  if (!book || !isChapterInBook(book, chapter)) return null;
  return {
    translation: curated.id,
    translationLabel: curated.label,
    book: book.id,
    bookName: book.commonName,
    chapter,
  };
}
