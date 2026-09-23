import type { SearchCorpus } from './build-index';

export interface SearchResult {
  b: string;
  c: number;
  v: number;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

function normalize(s: string): string {
  return s.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').toLowerCase();
}

const SNIPPET_RADIUS = 40;

export function searchCorpus(corpus: SearchCorpus, query: string, limit = 50): SearchResult[] {
  const needle = normalize(query.trim());
  if (!needle) return [];

  const results: SearchResult[] = [];
  for (let i = 0; i < corpus.verses.length && results.length < limit; i++) {
    const text = corpus.verses[i];
    const index = normalize(text).indexOf(needle);
    if (index === -1) continue;

    const start = Math.max(0, index - SNIPPET_RADIUS);
    const end = Math.min(text.length, index + needle.length + SNIPPET_RADIUS);
    const snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;

    results.push({
      b: corpus.refs[i].b,
      c: corpus.refs[i].c,
      v: corpus.refs[i].v,
      snippet,
      matchStart: index - start + (start > 0 ? 1 : 0),
      matchEnd: index - start + needle.length + (start > 0 ? 1 : 0),
    });
  }
  return results;
}