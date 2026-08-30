import { OT_BOOK_COUNT, getBookName } from './config';
import type { TranslationBook } from './types';

export interface ChapterRef {
  book: TranslationBook;
  chapter: number;
}

export function nextChapter(books: TranslationBook[], bookId: string, chapter: number): ChapterRef | null {
  const idx = books.findIndex((b) => b.id === bookId);
  if (idx === -1) return null;
  const book = books[idx];
  if (chapter < book.lastChapterNumber) {
    return { book, chapter: chapter + 1 };
  }
  const nextBook = books[idx + 1];
  return nextBook ? { book: nextBook, chapter: nextBook.firstChapterNumber } : null;
}

export function prevChapter(books: TranslationBook[], bookId: string, chapter: number): ChapterRef | null {
  const idx = books.findIndex((b) => b.id === bookId);
  if (idx === -1) return null;
  const book = books[idx];
  if (chapter > book.firstChapterNumber) {
    return { book, chapter: chapter - 1 };
  }
  const prevBook = books[idx - 1];
  return prevBook ? { book: prevBook, chapter: prevBook.lastChapterNumber } : null;
}

export function formatRef(book: TranslationBook, chapter: number): string {
  return `${getBookName(book.id)} ${chapter}`;
}

export function refToHref(translation: string, bookId: string, chapter: number, verse?: number): string {
  return `/bible/${translation}/${bookId}/${chapter}${verse ? `#v${verse}` : ''}`;
}

export function isOldTestament(book: TranslationBook): boolean {
  return !book.isApocryphal && book.order <= OT_BOOK_COUNT;
}