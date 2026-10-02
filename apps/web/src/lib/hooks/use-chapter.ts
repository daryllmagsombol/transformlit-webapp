'use client';

import { useEffect, useState } from 'react';
import { getChapter, getWords } from '../bible/api';
import { hasWordAnnotations } from '../bible/words';
import { BibleRepository } from '../bible/repository';
import { OfflineDatabase } from '../offline/database';
import { accountLifecycle } from '../offline/account-activation';
import type { BibleChapter, ChapterWords } from '../bible/types';

/**
 * Resolves a saved chapter from the offline store when the provider cannot be
 * reached. Returns null when nothing is stored or no local account is active,
 * so the caller still surfaces the same network error it would have.
 */
async function loadSavedChapter(
  translation: string,
  book: string,
  chapter: number,
): Promise<BibleChapter | null> {
  try {
    const owner = accountLifecycle().getOwner();
    if (!owner) return null;
    const repository = new BibleRepository({
      database: new OfflineDatabase(),
      getOwner: () => owner,
    });
    const opened = await repository.openChapter(translation, book, chapter);
    return {
      translation: opened.translationMeta,
      book: opened.bookMeta,
      thisChapterLink: '',
      nextChapterApiLink: null,
      previousChapterApiLink: null,
      numberOfVerses: 0,
      chapter: opened.chapterContent,
    };
  } catch {
    return null;
  }
}

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
        // The provider is unreachable. Fall back to a saved download so a
        // reader can open offline without a separate storage branch in the UI.
        const saved = await loadSavedChapter(translation, book, chapter);
        if (cancelled) return;
        if (saved) {
          setChapterData(saved);
          setLoading(false);
          return;
        }
        setError('Failed to load chapter.');
        setLoading(false);
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