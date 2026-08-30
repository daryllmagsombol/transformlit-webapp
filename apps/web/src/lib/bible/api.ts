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
      cache.set(url, { etag: existing.etag, data: existing.data });
      return existing.data;
    }
    if (!res.ok) {
      throw new Error(`Bible API ${res.status} for ${path}`);
    }
    const data = (await res.json()) as T;
    const etag = res.headers.get('etag');
    if (useCache) {
      cache.set(url, { etag, data });
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
    cache.set(url, { etag: prev?.etag ?? null, data: prev?.data as T, inflight: promise });
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