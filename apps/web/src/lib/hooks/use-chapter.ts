'use client';

import { useEffect, useState } from 'react';
import { getChapter, getWords } from '../bible/api';
import { hasWordAnnotations } from '../bible/words';
import type { BibleChapter, ChapterWords } from '../bible/types';

export function useChapter(translation: string, book: string, chapter: number) {
  const [chapterData, setChapterData] = useState<BibleChapter | null>(null);
  const [words, setWords] = useState<ChapterWords | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setChapterData(null);
    setWords(null);

    (async () => {
      let ch: BibleChapter;
      try {
        ch = await getChapter(translation, book, chapter);
      } catch {
        if (!cancelled) {
          setError('Failed to load chapter.');
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;

      // Publish the chapter and clear `loading` immediately. Word annotations are
      // optional enrichment and MUST NOT gate this: the reader renders its verse
      // DOM only once `loading` is false, and its `#v{n}` deep-link scroll is keyed
      // off this chapter payload. Awaiting words.json here kept the spinner over an
      // empty verse tree, so a cold/slow words request made the deep link exhaust
      // its retry budget and never scroll (it only worked on a later attempt, once
      // words.json was cached).
      setChapterData(ch);
      setLoading(false);

      if (!hasWordAnnotations(ch)) return;
      try {
        const w = await getWords(translation, book, chapter);
        if (!cancelled) setWords(w);
      } catch {
        // Word annotations are optional enrichment — degrade to "no word study"
        // without erroring the chapter.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [translation, book, chapter]);

  return { chapter: chapterData, words, loading, error };
}