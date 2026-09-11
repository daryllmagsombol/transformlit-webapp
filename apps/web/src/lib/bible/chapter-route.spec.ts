import {
  parseChapterNumber,
  findBookById,
  isChapterInBook,
  resolveChapterRoute,
} from './chapter-route';
import type { TranslationBook } from './types';

const books: TranslationBook[] = [
  { id: 'GEN', name: 'Genesis', commonName: 'Genesis', title: null, order: 1, numberOfChapters: 50, firstChapterNumber: 1, lastChapterNumber: 50, totalNumberOfVerses: 1533 },
  { id: 'ROM', name: 'Romans', commonName: 'Romans', title: null, order: 45, numberOfChapters: 16, firstChapterNumber: 1, lastChapterNumber: 16, totalNumberOfVerses: 433 },
];

// eng_web also serves the deuterocanon; TOB lives only in that list.
const engWebBooks: TranslationBook[] = [
  ...books,
  { id: 'TOB', name: 'Tobit', commonName: 'Tobit', title: null, order: 67, numberOfChapters: 14, firstChapterNumber: 1, lastChapterNumber: 14, totalNumberOfVerses: 230, isApocryphal: true },
];

const BSB = { id: 'BSB', label: 'Berean Standard Bible' };

describe('parseChapterNumber', () => {
  it('accepts plain positive integers', () => {
    expect(parseChapterNumber('1')).toBe(1);
    expect(parseChapterNumber('150')).toBe(150);
  });

  it('rejects non-numeric, zero, negative, float, hex and blank input', () => {
    expect(parseChapterNumber('abc')).toBeNull();
    expect(parseChapterNumber('0')).toBeNull();
    expect(parseChapterNumber('-3')).toBeNull();
    expect(parseChapterNumber('3.5')).toBeNull();
    expect(parseChapterNumber('0x10')).toBeNull();
    expect(parseChapterNumber('')).toBeNull();
    expect(parseChapterNumber('1e3')).toBeNull();
  });
});

describe('findBookById', () => {
  it('matches book ids case-insensitively and normalizes to canonical case', () => {
    expect(findBookById(books, 'rom')?.id).toBe('ROM');
    expect(findBookById(books, 'GEN')?.id).toBe('GEN');
  });

  it('resolves apocryphal books present in the translation list', () => {
    expect(findBookById(engWebBooks, 'tob')?.id).toBe('TOB');
  });

  it('returns undefined for unknown books', () => {
    expect(findBookById(books, 'ZZZ')).toBeUndefined();
  });
});

describe('isChapterInBook', () => {
  it('accepts chapters within the served range', () => {
    expect(isChapterInBook(books[0], 1)).toBe(true);
    expect(isChapterInBook(books[0], 50)).toBe(true);
  });

  it('rejects out-of-range chapters', () => {
    expect(isChapterInBook(books[0], 0)).toBe(false);
    expect(isChapterInBook(books[0], 51)).toBe(false);
  });
});

describe('resolveChapterRoute', () => {
  it('resolves a valid canonical route and uppercases the book id', () => {
    expect(resolveChapterRoute('bsb', 'rom', '12', books, BSB)).toEqual({
      translation: 'BSB',
      translationLabel: 'Berean Standard Bible',
      book: 'ROM',
      bookName: 'Romans',
      chapter: 12,
    });
  });

  it('rejects unknown translations', () => {
    expect(resolveChapterRoute('nkjv', 'ROM', '12', books, undefined)).toBeNull();
  });

  it('rejects unknown books', () => {
    expect(resolveChapterRoute('BSB', 'TOB', '1', books, BSB)).toBeNull();
    expect(resolveChapterRoute('BSB', 'ZZZ', '1', books, BSB)).toBeNull();
  });

  it('rejects non-integer / out-of-range chapters', () => {
    expect(resolveChapterRoute('BSB', 'ROM', 'abc', books, BSB)).toBeNull();
    expect(resolveChapterRoute('BSB', 'ROM', '0', books, BSB)).toBeNull();
    expect(resolveChapterRoute('BSB', 'ROM', '51', books, BSB)).toBeNull();
  });

  it('allows apocryphal books when present in the translation book list', () => {
    expect(resolveChapterRoute('eng_web', 'TOB', '3', engWebBooks, { id: 'eng_web', label: 'World English Bible Classic' })).toEqual({
      translation: 'eng_web',
      translationLabel: 'World English Bible Classic',
      book: 'TOB',
      bookName: 'Tobit',
      chapter: 3,
    });
  });
});
