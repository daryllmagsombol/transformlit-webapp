import { SearchClient } from './client';
import { getKVStore, setKVStore } from '../storage';
import type { KVStore } from '../storage';
import { createSearchWorker } from './worker-factory';
import { getCompleteTranslation } from '../api';
import type { CompleteTranslation } from '../types';

// worker-factory.ts contains `import.meta.url` (ESM-only). Jest runs CommonJS
// here, so mock it: the factory would fail to compile under a CommonJS transform.
jest.mock('./worker-factory', () => ({ createSearchWorker: jest.fn() }));
jest.mock('../api', () => ({ getCompleteTranslation: jest.fn() }));

class MemoryKV implements KVStore {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.map.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = jest.fn();
  terminate = jest.fn();
}

const corpus = {
  verses: ['For God so loved the world.'],
  refs: [{ b: 'JHN', c: 3, v: 16 }],
};

const complete: CompleteTranslation = {
  translation: { id: 'ENGWEBP', name: 'World English Bible', shortName: 'WEBP' },
  books: [
    {
      id: 'JHN',
      commonName: 'John',
      order: 43,
      numberOfChapters: 1,
      totalNumberOfVerses: 1,
      chapters: [{ chapter: { number: 1, content: [{ type: 'verse', number: 1, content: ['For God so loved the world.'] }] } }],
    },
  ],
};

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function answerLastMessage(worker: FakeWorker) {
  const msg = worker.postMessage.mock.calls.at(-1)?.[0] as { id: number };
  return msg;
}

describe('SearchClient', () => {
  let client: SearchClient;
  let workerFactoryMock: jest.Mock;
  let getCompleteTranslationMock: jest.Mock;

  beforeEach(() => {
    setKVStore(new MemoryKV());
    client = new SearchClient();
    workerFactoryMock = createSearchWorker as jest.Mock;
    getCompleteTranslationMock = getCompleteTranslation as jest.Mock;
    delete (globalThis as { Worker?: unknown }).Worker;
    workerFactoryMock.mockReset();
    getCompleteTranslationMock.mockReset();
  });

  describe('main-thread fallback', () => {
    it('stores the built index in the KV store', async () => {
      await client.persistCorpus('BSB', corpus);
      const stored = await getKVStore().get('bible:BSB:index');
      expect(stored).toEqual(corpus);
    });

    it('searches a stored corpus', async () => {
      await client.persistCorpus('BSB', corpus);
      const results = await client.search('BSB', 'loved');
      expect(results).toHaveLength(1);
      expect(results[0].b).toBe('JHN');
    });

    it('returns an empty list when no index exists', async () => {
      const results = await client.search('BSB', 'loved');
      expect(results).toEqual([]);
    });

    it('builds the index on the main thread and reports progress', async () => {
      getCompleteTranslationMock.mockResolvedValue(complete);
      const progress: Array<[string, number]> = [];
      client.onProgress((phase, pct) => progress.push([phase, pct]));

      await client.ensureIndex('ENGWEBP');

      expect(progress).toEqual([
        ['downloading', 0],
        ['downloading', 100],
        ['building', 100],
      ]);
      const stored = await getKVStore().get('bible:ENGWEBP:index');
      expect(stored).toEqual({ verses: ['For God so loved the world.'], refs: [{ b: 'JHN', c: 1, v: 1 }] });
    });

    it('skips building when an index already exists', async () => {
      await client.persistCorpus('BSB', corpus);
      const progress: Array<[string, number]> = [];
      client.onProgress((phase, pct) => progress.push([phase, pct]));

      await client.ensureIndex('BSB');

      expect(progress).toEqual([]);
      expect(getCompleteTranslationMock).not.toHaveBeenCalled();
    });

    it('falls back to the main thread when the worker factory throws', async () => {
      workerFactoryMock.mockImplementation(() => {
        throw new Error('no worker');
      });
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;
      getCompleteTranslationMock.mockResolvedValue(complete);

      await client.ensureIndex('ENGWEBP');
      expect(await getKVStore().get('bible:ENGWEBP:index')).toEqual(
        expect.objectContaining({ verses: ['For God so loved the world.'] }),
      );
    });
  });

  describe('worker path', () => {
    it('builds the index in a worker and persists it', async () => {
      getCompleteTranslationMock.mockResolvedValue(complete);
      const worker = new FakeWorker();
      workerFactoryMock.mockReturnValue(worker);
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;
      const progress: Array<[string, number]> = [];
      client.onProgress((phase, pct) => progress.push([phase, pct]));

      const pending = client.ensureIndex('ENGWEBP');
      await tick();
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'build', payload: complete }),
      );
      const msg = await answerLastMessage(worker);
      worker.onmessage!({ data: { id: msg.id, kind: 'built', corpus } });

      await pending;
      expect(progress).toEqual([
        ['downloading', 0],
        ['downloading', 100],
        ['building', 0],
        ['building', 100],
      ]);
      expect(await getKVStore().get('bible:ENGWEBP:index')).toEqual(corpus);
    });

    it('searches through the worker', async () => {
      await client.persistCorpus('BSB', corpus);
      const worker = new FakeWorker();
      workerFactoryMock.mockReturnValue(worker);
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;

      const pending = client.search('BSB', 'loved');
      await tick();
      const msg = await answerLastMessage(worker);
      expect(msg.kind).toBe('search');
      worker.onmessage!({
        data: { id: msg.id, kind: 'results', results: [{ b: 'JHN', c: 3, v: 16, snippet: 'loved', matchStart: 0, matchEnd: 5 }] },
      });

      expect(await pending).toEqual([{ b: 'JHN', c: 3, v: 16, snippet: 'loved', matchStart: 0, matchEnd: 5 }]);
    });

    it('falls back to the main thread when a worker message rejects', async () => {
      await client.persistCorpus('BSB', corpus);
      const worker = new FakeWorker();
      workerFactoryMock.mockReturnValue(worker);
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;

      const pending = client.search('BSB', 'loved');
      await tick();
      const msg = await answerLastMessage(worker);
      worker.onmessage!({ data: { id: msg.id, kind: 'error' } });

      const results = await pending;
      expect(results).toHaveLength(1);
      expect(results[0].b).toBe('JHN');
    });

    it('rejects pending work and drops the dead worker on worker error', async () => {
      const worker = new FakeWorker();
      workerFactoryMock.mockReturnValue(worker);
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;
      getCompleteTranslationMock.mockResolvedValue(complete);

      const pending = client.ensureIndex('ENGWEBP').catch((e: Error) => e);
      await tick();
      worker.onerror!();

      const err = await pending;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('worker failed');

      // A later call recreates the worker instead of reusing the dead one.
      const worker2 = new FakeWorker();
      workerFactoryMock.mockReturnValue(worker2);
      const pending2 = client.ensureIndex('ENGWEBP');
      await tick();
      expect(workerFactoryMock).toHaveBeenCalledTimes(2);
      const msg2 = await answerLastMessage(worker2);
      worker2.onmessage!({ data: { id: msg2.id, kind: 'built', corpus } });
      await pending2;
    });

    it('terminates and drops the worker on dispose', async () => {
      await client.persistCorpus('BSB', corpus);
      const worker = new FakeWorker();
      workerFactoryMock.mockReturnValue(worker);
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;

      const pending = client.search('BSB', 'loved');
      await tick();
      const msg = await answerLastMessage(worker);
      worker.onmessage!({ data: { id: msg.id, kind: 'results', results: [] } });
      await pending;

      client.dispose();
      expect(worker.terminate).toHaveBeenCalled();
    });
  });
});