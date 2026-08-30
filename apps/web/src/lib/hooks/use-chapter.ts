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
      try {
        const ch = await getChapter(translation, book, chapter);
        if (cancelled) return;
        setChapterData(ch);
        if (hasWordAnnotations(ch)) {
          const w = await getWords(translation, book, chapter);
          if (!cancelled) setWords(w);
        }
      } catch {
        if (!cancelled) setError('Failed to load chapter.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [translation, book, chapter]);

  return { chapter: chapterData, words, loading, error };
}