import type { BibleChapter, ChapterWord, FormattedText, InlineHeading, InlineLineBreak, VerseFootnoteReference } from './types';

export type VerseContentItem = string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference;

export function flattenVerseText(content: VerseContentItem[]): string {
  let text = '';
  for (const item of content) {
    if (typeof item === 'string') {
      text += item;
    } else if ('text' in item && typeof item.text === 'string') {
      text += item.text;
    } else if ('heading' in item && typeof item.heading === 'string') {
      text += item.heading;
    }
    // footnote refs ({noteId}) and line breaks contribute no text
  }
  return text;
}

export interface WordSpan {
  start: number;
  end: number;
  word: ChapterWord;
}

/** Offsets into the flattened verse text are cumulative per content item. */
export function mapWordSpans(content: VerseContentItem[], words: ChapterWord[]): WordSpan[] {
  function getItemLength(item: VerseContentItem): number {
    if (typeof item === 'string') return item.length;
    if ('text' in item && typeof item.text === 'string') return item.text.length;
    if ('heading' in item && typeof item.heading === 'string') return item.heading.length;
    return 0;
  }

  const offsets = content.map(getItemLength);
  const baseAt = (index: number) => offsets.slice(0, index).reduce((a, b) => a + b, 0);

  const spans: WordSpan[] = [];
  for (const word of words) {
    if (word.contentIndex < 0 || word.contentIndex >= content.length) continue;
    spans.push({
      start: baseAt(word.contentIndex) + word.start,
      end: baseAt(word.contentIndex) + word.end,
      word,
    });
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

export function hasWordAnnotations(chapter: BibleChapter): boolean {
  return Boolean(chapter.thisChapterWordsLink);
}