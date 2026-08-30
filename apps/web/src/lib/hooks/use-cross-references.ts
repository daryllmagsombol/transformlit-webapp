'use client';

import { useCallback, useState } from 'react';
import { getCrossReferences } from '../bible/api';
import type { CrossRefReference } from '../bible/types';

export function useCrossReferences(book: string, chapter: number) {
  const [byVerse, setByVerse] = useState<Record<number, CrossRefReference[]>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCrossReferences(book, chapter);
      const map: Record<number, CrossRefReference[]> = {};
      for (const item of result.chapter.content) {
        map[item.verse] = item.references;
      }
      setByVerse(map);
    } catch {
      // dataset 404 / sparse coverage → treat as empty
      setByVerse({});
    } finally {
      setLoading(false);
    }
  }, [book, chapter]);

  return { byVerse, loading, load };
}