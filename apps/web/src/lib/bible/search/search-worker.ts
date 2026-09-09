import { buildIndex, type SearchCorpus } from './build-index';
import { searchCorpus } from './matcher';
import type { CompleteTranslation } from '../types';

interface BuildMessage {
  kind: 'build';
  id: number;
  payload: CompleteTranslation;
}
interface SearchMessage {
  kind: 'search';
  id: number;
  payload: { corpus: SearchCorpus; query: string; limit: number };
}

globalThis.onmessage = (event: MessageEvent<BuildMessage | SearchMessage>) => {
  const msg = event.data;
  if (msg.kind === 'build') {
    const corpus = buildIndex(msg.payload);
    (globalThis as unknown as Worker).postMessage({ id: msg.id, kind: 'built', corpus });
  } else if (msg.kind === 'search') {
    const results = searchCorpus(msg.payload.corpus, msg.payload.query, msg.payload.limit);
    (globalThis as unknown as Worker).postMessage({ id: msg.id, kind: 'results', results });
  }
};

export type { BuildMessage, SearchMessage };
export type { SearchResult } from './matcher';