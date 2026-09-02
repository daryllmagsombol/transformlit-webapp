import { flattenVerseText, type VerseContentItem } from '../words';
import type { CompleteTranslation } from '../types';

export interface SearchCorpus {
  verses: string[];
  refs: { b: string; c: number; v: number }[];
}

export function buildIndex(complete: CompleteTranslation): SearchCorpus {
  const verses: string[] = [];
  const refs: { b: string; c: number; v: number }[] = [];

  for (const book of complete.books) {
    for (const ch of book.chapters) {
      for (const item of ch.chapter.content) {
        if (item.type !== 'verse') continue;
        const text = flattenVerseText(item.content as VerseContentItem[]);
        if (!text) continue;
        verses.push(text);
        refs.push({ b: book.id, c: ch.chapter.number, v: item.number });
      }
    }
  }

  return { verses, refs };
}