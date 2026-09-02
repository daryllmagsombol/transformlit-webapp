'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchClient, type SearchClient as SearchClientType } from '../bible/search/client';
import type { SearchResult } from '../bible/search/matcher';
import { useBibleStore } from '../../store/bible-store';

export function useBibleSearch(translation: string) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<SearchClientType | null>(null);
  const setIndexStatus = useBibleStore((s) => s.setIndexStatus);

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = new SearchClient();
    return clientRef.current;
  }, []);

  const ensureIndex = useCallback(async () => {
    setIndexing(true);
    setProgress(0);
    const client = getClient();
    client.onProgress((phase, pct) => {
      setProgress(phase === 'downloading' ? pct / 2 : 50 + pct / 2);
    });
    try {
      await client.ensureIndex(translation);
      setIndexStatus(translation, 'ready');
    } catch {
      setError('Could not prepare this translation for search.');
    } finally {
      setIndexing(false);
    }
  }, [translation, getClient, setIndexStatus]);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      const client = getClient();
      const found = await client.search(translation, q);
      setResults(found);
    },
    [translation, getClient],
  );

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void search(query);
    }, 200);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => () => clientRef.current?.dispose(), []);

  return { query, setQuery, results, indexing, progress, error, ensureIndex };
}
