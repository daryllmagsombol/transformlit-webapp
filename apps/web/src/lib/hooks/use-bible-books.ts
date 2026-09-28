'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBooks } from '../bible/api';
import type { TranslationBook } from '../bible/types';

export function useBibleBooks(translation: string) {
  const [books, setBooks] = useState<TranslationBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id so a slower earlier fetch (e.g. a previous translation)
  // can never overwrite state written by a newer one.
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = (requestIdRef.current += 1);
    setLoading(true);
    setError(null);
    try {
      const result = await getBooks(translation);
      if (requestId !== requestIdRef.current) return;
      setBooks(result.books);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError('Failed to load books.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [translation]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { books, loading, error, reload };
}