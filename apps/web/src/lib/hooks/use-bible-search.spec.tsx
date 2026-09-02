import { renderHook, act, waitFor } from '@testing-library/react';
import { useBibleSearch } from './use-bible-search';
import { SearchClient } from '../bible/search/client';
import { useBibleStore } from '../../store/bible-store';

jest.mock('../bible/search/worker-factory', () => ({ createSearchWorker: jest.fn() }));

jest.mock('../bible/search/client', () => {
  const actual = jest.requireActual('../bible/search/client');
  return { ...actual, SearchClient: jest.fn() };
});

const mockEnsureIndex = jest.fn();
const mockSearch = jest.fn();
const mockDispose = jest.fn();
let progressCb: ((phase: 'downloading' | 'building', pct: number) => void) | null = null;

(SearchClient as unknown as jest.Mock).mockImplementation(() => ({
  ensureIndex: mockEnsureIndex,
  search: mockSearch,
  onProgress: (cb: (phase: 'downloading' | 'building', pct: number) => void) => {
    progressCb = cb;
  },
  dispose: mockDispose,
}));

describe('useBibleSearch', () => {
  beforeEach(() => {
    mockEnsureIndex.mockReset().mockResolvedValue(undefined);
    mockSearch.mockReset().mockResolvedValue([]);
    mockDispose.mockReset();
    progressCb = null;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs ensureIndex and marks the translation ready', async () => {
    const { result } = renderHook(() => useBibleSearch('ENGWEBP'));
    expect(result.current.indexing).toBe(false);

    await act(async () => {
      result.current.ensureIndex();
    });

    expect(mockEnsureIndex).toHaveBeenCalledWith('ENGWEBP');
    expect(useBibleStore.getState().indexStatus['ENGWEBP']).toBe('ready');
    expect(result.current.indexing).toBe(false);
  });

  it('maps progress phases into a 0-100 percentage', async () => {
    const { result } = renderHook(() => useBibleSearch('ENGWEBP'));
    const pending = act(async () => {
      result.current.ensureIndex();
    });
    progressCb?.('downloading', 100);
    progressCb?.('building', 50);
    await pending;
    expect(result.current.progress).toBe(75);
  });

  it('surfaces an error when ensureIndex fails', async () => {
    mockEnsureIndex.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useBibleSearch('ENGWEBP'));
    await act(async () => {
      await result.current.ensureIndex();
    });
    expect(result.current.error).toBe('Could not prepare this translation for search.');
  });

  it('debounces search input and stores results', async () => {
    mockSearch.mockResolvedValue([{ b: 'JHN', c: 3, v: 16, snippet: 'loved', matchStart: 0, matchEnd: 5 }]);
    const { result } = renderHook(() => useBibleSearch('BSB'));

    await act(async () => {
      result.current.setQuery('love');
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(mockSearch).toHaveBeenCalledWith('BSB', 'love');
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].b).toBe('JHN');
  });

  it('clears results when the query is emptied', async () => {
    const { result } = renderHook(() => useBibleSearch('BSB'));
    await act(async () => {
      result.current.setQuery('love');
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(mockSearch).toHaveBeenCalled();

    await act(async () => {
      result.current.setQuery('');
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current.results).toEqual([]);
  });

  it('disposes the search client on unmount', async () => {
    const { result, unmount } = renderHook(() => useBibleSearch('BSB'));
    await act(async () => {
      await result.current.ensureIndex();
    });
    unmount();
    expect(mockDispose).toHaveBeenCalled();
  });
});