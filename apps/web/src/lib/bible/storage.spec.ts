import { getKVStore, setKVStore, KVStore, loadPrefs, savePrefs } from './storage';

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

describe('bible storage', () => {
  const store = new MemoryKV();

  beforeEach(() => setKVStore(store));

  it('round-trips values through the injected store', async () => {
    await getKVStore().set('chapter', { book: 'ROM', chapter: 12 });
    expect(await getKVStore().get<{ book: string; chapter: number }>('chapter')).toEqual({
      book: 'ROM',
      chapter: 12,
    });
  });

  it('deletes values', async () => {
    await getKVStore().set('temp', 1);
    await getKVStore().del('temp');
    expect(await getKVStore().get<number>('temp')).toBeNull();
  });

  it('persists prefs to localStorage', () => {
    savePrefs({ translation: 'BSB' });
    expect(loadPrefs()).toEqual({ translation: 'BSB' });
  });
});