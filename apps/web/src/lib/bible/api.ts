import { BIBLE_API_BASE } from './config';
import type {
  BibleChapter,
  ChapterWords,
  CompleteTranslation,
  CrossRefChapter,
  TranslationBook,
} from './types';

interface CacheEntry<T> {
  etag: string | null;
  data: T;
  inflight?: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Bounded L1 cache. Long reading sessions touch many chapters (and their
 * words/cross-ref payloads), so an unbounded Map would grow for the tab's
 * lifetime. Map preserves insertion order, so the first key is the least
 * recently written; deleting before re-inserting keeps recency accurate.
 */
const MAX_CACHE_ENTRIES = 50;

function setCache(url: string, entry: CacheEntry<unknown>): void {
  cache.delete(url);
  cache.set(url, entry);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function fetchBible<T>(path: string, useCache = true): Promise<T> {
  const url = `${BIBLE_API_BASE}${path}`;
  const existing = cache.get(url) as CacheEntry<T> | undefined;

  if (useCache && existing?.inflight) return existing.inflight;
  if (useCache && existing && !existing.etag) return existing.data;

  const doFetch = async (): Promise<T> => {
    const headers: Record<string, string> = {};
    if (existing?.etag) headers['If-None-Match'] = existing.etag;

    const res = await fetch(url, { headers });
    if (res.status === 304 && existing) {
      setCache(url, { etag: existing.etag, data: existing.data });
      return existing.data;
    }
    if (!res.ok) {
      throw new Error(`Bible API ${res.status} for ${path}`);
    }
    const data = (await res.json()) as T;
    const etag = res.headers.get('etag');
    if (useCache) {
      setCache(url, { etag, data });
    }
    return data;
  };

  let failed = false;
  const promise = doFetch().catch((err) => {
    failed = true;
    throw err;
  });
  if (useCache) {
    const prev = cache.get(url) as CacheEntry<T> | undefined;
    setCache(url, { etag: prev?.etag ?? null, data: prev?.data as T, inflight: promise });
    try {
      return await promise;
    } finally {
      const entry = cache.get(url) as CacheEntry<T> | undefined;
      if (entry) {
        delete entry.inflight;
        // A failed first-ever fetch would otherwise leave { etag: null, data: undefined }
        // behind, poisoning later calls via the `existing && !existing.etag` short-circuit
        // (they would resolve `undefined` with no fetch). Drop it so retries re-fetch.
        // A pre-existing valid entry (prev) is preserved and keeps its etag/data.
        if (!prev && failed) cache.delete(url);
      }
    }
  }
  return promise;
}

export async function getBooks(translation: string): Promise<{ translation: { id: string }; books: TranslationBook[] }> {
  return fetchBible(`/${translation}/books.json`);
}

export async function getChapter(translation: string, book: string, chapter: number): Promise<BibleChapter> {
  return fetchBible(`/${translation}/${book}/${chapter}.json`);
}

export async function getWords(translation: string, book: string, chapter: number): Promise<ChapterWords> {
  return fetchBible(`/${translation}/${book}/${chapter}.words.json`);
}

export async function getCrossReferences(book: string, chapter: number): Promise<CrossRefChapter> {
  return fetchBible(`/d/open-cross-ref/${book}/${chapter}.json`);
}

export async function getCompleteTranslation(translation: string): Promise<CompleteTranslation> {
  return fetchBible(`/${translation}/complete.json`, false);
}

/** Test/edge helper: clear the module-level L1 cache (use in spec beforeEach). */
export function clearBibleCache(): void {
  cache.clear();
}