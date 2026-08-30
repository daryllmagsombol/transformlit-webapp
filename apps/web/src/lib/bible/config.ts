export const BIBLE_API_BASE = 'https://bible.helloao.org/api';

export const DEFAULT_TRANSLATION = 'BSB';

export interface CuratedTranslation {
  id: string;
  label: string;
  language: 'English' | 'Tagalog';
  hasWords: boolean;
  hasAudio: boolean;
}

export const CURATED_TRANSLATIONS: CuratedTranslation[] = [
  { id: 'BSB', label: 'Berean Standard Bible', language: 'English', hasWords: false, hasAudio: true },
  { id: 'ENGWEBP', label: 'World English Bible', language: 'English', hasWords: true, hasAudio: false },
  { id: 'eng_kjv', label: 'King James Version', language: 'English', hasWords: false, hasAudio: false },
  { id: 'eng_asv', label: 'American Standard Version (1901)', language: 'English', hasWords: false, hasAudio: false },
  { id: 'eng_web', label: 'World English Bible Classic', language: 'English', hasWords: false, hasAudio: false },
  { id: 'tgl_ulb', label: 'Banal na Bibliya', language: 'Tagalog', hasWords: false, hasAudio: false },
];

export function getCuratedTranslation(id: string): CuratedTranslation | undefined {
  return CURATED_TRANSLATIONS.find((t) => t.id === id);
}

/** Case-insensitive curated lookup — API ids are mixed-case (BSB, eng_kjv, tgl_ulb). */
export function findCuratedTranslation(id: string): CuratedTranslation | undefined {
  const lower = id.toLowerCase();
  return CURATED_TRANSLATIONS.find((t) => t.id.toLowerCase() === lower);
}

/** USFM book id → common name (static; used for metadata before books.json loads). */
export const BOOK_NAMES: Record<string, string> = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms',
  PRO: 'Proverbs', ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah',
  JER: 'Jeremiah', LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah',
  NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah',
  MAL: 'Malachi', MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John',
  ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy',
  '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews', JAS: 'James',
  '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
  '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

export function getBookName(id: string): string {
  return BOOK_NAMES[id] ?? id;
}

/** Books in the canonical order are split at Matthew (order index 39). */
export const OT_BOOK_COUNT = 39;

export const QUICK_TRACKS = [
  { label: 'Romans 12', book: 'ROM', chapter: 12 },
  { label: 'Proverbs 12', book: 'PRO', chapter: 12 },
  { label: 'Matthew 5', book: 'MAT', chapter: 5 },
] as const;