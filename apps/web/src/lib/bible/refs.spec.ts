import { nextChapter, prevChapter, formatRef, refToHref, isOldTestament } from './refs';
import type { TranslationBook } from './types';

const books: TranslationBook[] = [
  { id: 'GEN', name: 'Genesis', commonName: 'Genesis', title: null, order: 1, numberOfChapters: 50, firstChapterNumber: 1, lastChapterNumber: 50, totalNumberOfVerses: 1533 },
  { id: 'EXO', name: 'Exodus', commonName: 'Exodus', title: null, order: 2, numberOfChapters: 40, firstChapterNumber: 1, lastChapterNumber: 40, totalNumberOfVerses: 1213 },
  { id: 'MAT', name: 'Matthew', commonName: 'Matthew', title: null, order: 40, numberOfChapters: 28, firstChapterNumber: 1, lastChapterNumber: 28, totalNumberOfVerses: 1071 },
  { id: 'REV', name: 'Revelation', commonName: 'Revelation', title: null, order: 66, numberOfChapters: 22, firstChapterNumber: 1, lastChapterNumber: 22, totalNumberOfVerses: 404 },
];

describe('nextChapter', () => {
  it('moves to the next chapter within a book', () => {
    expect(nextChapter(books, 'GEN', 1)).toEqual({ book: books[0], chapter: 2 });
  });

  it('wraps to the first chapter of the next book at a book boundary', () => {
    expect(nextChapter(books, 'GEN', 50)).toEqual({ book: books[1], chapter: 1 });
  });

  it('returns null after the last chapter of the last book', () => {
    expect(nextChapter(books, 'REV', 22)).toBeNull();
  });
});

describe('prevChapter', () => {
  it('moves to the previous chapter within a book', () => {
    expect(prevChapter(books, 'GEN', 2)).toEqual({ book: books[0], chapter: 1 });
  });

  it('wraps to the last chapter of the previous book', () => {
    expect(prevChapter(books, 'EXO', 1)).toEqual({ book: books[0], chapter: 50 });
  });

  it('returns null before the first chapter of the first book', () => {
    expect(prevChapter(books, 'GEN', 1)).toBeNull();
  });
});

describe('formatRef / refToHref / isOldTestament', () => {
  it('formats a reference', () => {
    expect(formatRef(books[2], 5)).toBe('Matthew 5');
  });

  it('builds a reader href with optional verse', () => {
    expect(refToHref('BSB', 'ROM', 12)).toBe('/bible/BSB/ROM/12');
    expect(refToHref('BSB', 'ROM', 12, 2)).toBe('/bible/BSB/ROM/12#v2');
  });

  it('splits OT vs NT by canonical order', () => {
    expect(isOldTestament(books[0])).toBe(true);
    expect(isOldTestament(books[2])).toBe(false);
  });
});