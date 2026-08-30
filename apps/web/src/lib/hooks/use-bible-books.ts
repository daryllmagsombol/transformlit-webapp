'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBooks } from '../bible/api';
import type { TranslationBook } from '../bible/types';

export function useBibleBooks(translation: string) {
  const [books, setBooks] = useState<TranslationBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getBooks(translation);
      setBooks(result.books);
    } catch {
      setError('Failed to load books.');
    } finally {
      setLoading(false);
    }
  }, [translation]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { books, loading, error, reload };
}