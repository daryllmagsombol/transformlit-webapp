import { getCompleteTranslation } from '../api';
import { getKVStore } from '../storage';
import { buildIndex, type SearchCorpus } from './build-index';
import { searchCorpus, type SearchResult } from './matcher';
import { createSearchWorker } from './worker-factory';

export class SearchClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private onProgressCb: ((phase: 'downloading' | 'building', pct: number) => void) | null = null;

  onProgress(cb: (phase: 'downloading' | 'building', pct: number) => void): void {
    this.onProgressCb = cb;
  }

  private getWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    if (!this.worker) {
      try {
        this.worker = createSearchWorker();
        this.worker.onmessage = (event) => {
          const msg = event.data as { id?: number; kind: string; [k: string]: unknown };
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.kind === 'built') resolve(msg.corpus);
            else if (msg.kind === 'results') resolve(msg.results);
            else reject(new Error('worker error'));
          }
        };
        this.worker.onerror = () => {
          const pending = Array.from(this.pending.values());
          this.pending.clear();
          // Null out the dead worker so a later call recreates it instead of
          // silently hanging on a worker that will never answer.
          this.worker = null;
          for (const { reject } of pending) reject(new Error('worker failed'));
        };
      } catch {
        this.worker = null;
      }
    }
    return this.worker;
  }

  private post<T>(msg: Record<string, unknown>): Promise<T> {
    const worker = this.getWorker();
    if (!worker) return Promise.reject(new Error('no-worker'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...msg });
    });
  }

  async persistCorpus(translation: string, corpus: SearchCorpus): Promise<void> {
    await getKVStore().set(`bible:${translation}:index`, corpus);
  }

  private async getCorpus(translation: string): Promise<SearchCorpus | null> {
    return getKVStore().get<SearchCorpus>(`bible:${translation}:index`);
  }

  async ensureIndex(translation: string): Promise<void> {
    const existing = await this.getCorpus(translation);
    if (existing) return;

    this.onProgressCb?.('downloading', 0);
    const complete = await getCompleteTranslation(translation);
    this.onProgressCb?.('downloading', 100);

    let corpus: SearchCorpus;
    const worker = this.getWorker();
    if (worker) {
      this.onProgressCb?.('building', 0);
      corpus = await this.post<SearchCorpus>({ kind: 'build', payload: complete });
    } else {
      corpus = buildIndex(complete);
    }
    this.onProgressCb?.('building', 100);
    await this.persistCorpus(translation, corpus);
  }

  async search(translation: string, query: string, limit = 50): Promise<SearchResult[]> {
    const corpus = await this.getCorpus(translation);
    if (!corpus) return [];

    const worker = this.getWorker();
    if (worker) {
      try {
        return await this.post<SearchResult[]>({ kind: 'search', payload: { corpus, query, limit } });
      } catch {
        // fall through to main thread
      }
    }
    return searchCorpus(corpus, query, limit);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}