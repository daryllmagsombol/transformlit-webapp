import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchPanel } from './search-panel';
import { SearchClient } from '../../lib/bible/search/client';
import { getKVStore, setKVStore } from '../../lib/bible/storage';
import type { KVStore } from '../../lib/bible/storage';

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

jest.mock('../../lib/bible/search/worker-factory', () => ({
  createSearchWorker: jest.fn(),
}));

jest.mock('../../lib/bible/search/client', () => {
  const actual = jest.requireActual('../../lib/bible/search/client');
  return { ...actual, SearchClient: jest.fn() };
});

const mockSearch = jest.fn();
(SearchClient as unknown as jest.Mock).mockImplementation(() => ({
  persistCorpus: jest.fn(),
  ensureIndex: jest.fn().mockResolvedValue(undefined),
  search: mockSearch,
  onProgress: jest.fn(),
  dispose: jest.fn(),
}));

describe('SearchPanel', () => {
  beforeEach(() => {
    setKVStore(new MemoryKV());
    mockSearch.mockReset();
    mockSearch.mockResolvedValue([
      { b: 'JHN', c: 3, v: 16, snippet: 'For God so …loved… the world', matchStart: 11, matchEnd: 16 },
    ]);
  });

  it('searches and renders results after typing', async () => {
    render(<SearchPanel translation="BSB" onResult={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search the Bible'), { target: { value: 'loved' } });
    await waitFor(() => expect(screen.getByText(/John 3:16/)).toBeInTheDocument());
  });
});
