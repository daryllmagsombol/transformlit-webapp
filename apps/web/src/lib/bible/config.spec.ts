import { CURATED_TRANSLATIONS, DEFAULT_TRANSLATION, OT_BOOK_COUNT, QUICK_TRACKS, BOOK_NAMES } from './config';

describe('bible config', () => {
  it('defaults to BSB', () => {
    expect(DEFAULT_TRANSLATION).toBe('BSB');
  });

  it('curates the expected translations', () => {
    const ids = CURATED_TRANSLATIONS.map((t) => t.id);
    expect(ids).toEqual(['BSB', 'ENGWEBP', 'eng_kjv', 'eng_asv', 'eng_web', 'tgl_ulb']);
  });

  it('flags ENGWEBP as the word-studies translation', () => {
    const webp = CURATED_TRANSLATIONS.find((t) => t.id === 'ENGWEBP');
    expect(webp?.hasWords).toBe(true);
  });

  it('groups the Tagalog translation', () => {
    expect(CURATED_TRANSLATIONS.find((t) => t.id === 'tgl_ulb')?.language).toBe('Tagalog');
  });

  it('knows the OT/NT boundary', () => {
    expect(OT_BOOK_COUNT).toBe(39);
  });

  it('has quick tracks for Romans 12, Proverbs 12, Matthew 5', () => {
    expect(QUICK_TRACKS).toEqual([
      { label: 'Romans 12', book: 'ROM', chapter: 12 },
      { label: 'Proverbs 12', book: 'PRO', chapter: 12 },
      { label: 'Matthew 5', book: 'MAT', chapter: 5 },
    ]);
  });

  it('maps Genesis and Romans in BOOK_NAMES', () => {
    expect(BOOK_NAMES.GEN).toBe('Genesis');
    expect(BOOK_NAMES.ROM).toBe('Romans');
  });
});