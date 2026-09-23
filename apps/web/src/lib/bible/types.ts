/** Subset types for the Free Use Bible API (bible.helloao.org). Standard format only. */

export interface TranslationBook {
  id: string;
  name: string;
  commonName: string;
  title: string | null;
  order: number;
  numberOfChapters: number;
  firstChapterNumber: number;
  lastChapterNumber: number;
  totalNumberOfVerses: number;
  isApocryphal?: boolean;
}

export interface FormattedText {
  text: string;
  poem?: number;
  wordsOfJesus?: boolean;
}

export interface InlineHeading {
  heading: string;
}

export interface InlineLineBreak {
  lineBreak: true;
}

export interface VerseFootnoteReference {
  noteId: number;
}

export type ChapterContent =
  | { type: 'heading'; content: string[] }
  | { type: 'line_break' }
  | { type: 'hebrew_subtitle'; content: (string | FormattedText | VerseFootnoteReference)[] }
  | {
      type: 'verse';
      number: number;
      content: (string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference)[];
    };

export interface ChapterFootnote {
  noteId: number;
  text: string;
  caller: string | null;
  reference?: { chapter: number; verse: number };
}

export interface BibleChapter {
  translation: { id: string; name: string; shortName: string };
  book: TranslationBook;
  thisChapterLink: string;
  nextChapterApiLink: string | null;
  previousChapterApiLink: string | null;
  thisChapterAudioLinks?: Record<string, string>;
  thisChapterWordsLink?: string;
  numberOfVerses: number;
  chapter: { number: number; content: ChapterContent[]; footnotes: ChapterFootnote[] };
}

export interface ChapterWord {
  contentIndex: number;
  start: number;
  end: number;
  strongs?: string[];
  lemma?: string;
  morph?: string;
  srcloc?: string;
}

export interface ChapterWords {
  verses: Record<string, ChapterWord[]>;
}

export interface CrossRefReference {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  score?: number;
}

export interface CrossRefVerse {
  verse: number;
  references: CrossRefReference[];
}

export interface CrossRefChapter {
  chapter: { number: number; content: CrossRefVerse[] };
}

export interface CompleteBook {
  id: string;
  commonName: string;
  order: number;
  numberOfChapters: number;
  totalNumberOfVerses: number;
  chapters: { chapter: { number: number; content: ChapterContent[] } }[];
}

export interface CompleteTranslation {
  translation: { id: string; name: string; shortName: string };
  books: CompleteBook[];
}
