'use client';

import { useCallback, useRef, useState } from 'react';
import { getCrossReferences } from '../bible/api';
import type { CrossRefReference } from '../bible/types';

export function useCrossReferences(book: string, chapter: number) {
  const [byVerse, setByVerse] = useState<Record<number, CrossRefReference[]>>({});
  const [loading, setLoading] = useState(false);
  // Monotonic request id so a stale cross-reference response for a previous
  // book/chapter cannot overwrite the current one.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = (requestIdRef.current += 1);
    setLoading(true);
    try {
      const result = await getCrossReferences(book, chapter);
      if (requestId !== requestIdRef.current) return;
      const map: Record<number, CrossRefReference[]> = {};
      for (const item of result.chapter.content) {
        map[item.verse] = item.references;
      }
      setByVerse(map);
    } catch {
      if (requestId !== requestIdRef.current) return;
      // dataset 404 / sparse coverage → treat as empty
      setByVerse({});
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [book, chapter]);

  return { byVerse, loading, load };
}