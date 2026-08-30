import { SearchClient } from './client';
import { getKVStore, setKVStore } from '../storage';
import type { KVStore } from '../storage';

// worker-factory.ts contains `import.meta.url` (ESM-only). Jest runs CommonJS
// here, so mock it: the worker path is never exercised in jsdom (no Worker),
// and the factory would fail to compile under a CommonJS transform.
jest.mock('./worker-factory', () => ({ createSearchWorker: jest.fn() }));

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

const corpus = {
  verses: ['For God so loved the world.'],
  refs: [{ b: 'JHN', c: 3, v: 16 }],
};

describe('SearchClient (main-thread fallback)', () => {
  let client: SearchClient;

  beforeEach(() => {
    setKVStore(new MemoryKV());
    client = new SearchClient();
  });

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
});