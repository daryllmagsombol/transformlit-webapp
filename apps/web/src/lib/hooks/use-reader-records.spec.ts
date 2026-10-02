import { act, renderHook, waitFor } from '@testing-library/react';

/**
 * The hook is a thin React wrapper over the durable `readerRecords()` store.
 * Mocking the store lets us drive every state branch (initial read, error
 * fallback, and the stale-request guard) without a real IndexedDB.
 */
const mockListHighlights = jest.fn();
const mockListBookmarks = jest.fn();
const mockReaderRecords = jest.fn(() => ({
  listHighlights: mockListHighlights,
  listBookmarks: mockListBookmarks,
}));

jest.mock('../offline/reader-records', () => ({
  readerRecords: () => mockReaderRecords(),
  resetReaderRecordsForTests: jest.fn(),
}));

import { useReaderAnnotations } from './use-reader-records';

describe('useReaderAnnotations', () => {
  beforeEach(() => {
    mockListHighlights.mockReset();
    mockListBookmarks.mockReset();
    mockReaderRecords.mockClear();
  });

  it('reads the durable highlights and bookmarks for the book', async () => {
    mockListHighlights.mockResolvedValue([{ id: 'h1' }]);
    mockListBookmarks.mockResolvedValue([{ id: 'b1' }]);

    const { result } = renderHook(() => useReaderAnnotations('book-1'));

    await waitFor(() => {
      expect(result.current.highlights).toEqual([{ id: 'h1' }]);
    });
    expect(result.current.bookmarks).toEqual([{ id: 'b1' }]);
    expect(mockListHighlights).toHaveBeenCalledWith('book-1');
    expect(mockListBookmarks).toHaveBeenCalledWith('book-1');
  });

  it('falls back to an empty local state when the read rejects', async () => {
    mockListHighlights.mockResolvedValueOnce([{ id: 'h1' }]);
    mockListBookmarks.mockResolvedValueOnce([{ id: 'b1' }]);

    const { result } = renderHook(() => useReaderAnnotations('book-1'));
    await waitFor(() => {
      expect(result.current.highlights).toHaveLength(1);
    });

    mockListHighlights.mockRejectedValueOnce(new Error('local read failed'));
    mockListBookmarks.mockResolvedValueOnce([]);
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.highlights).toEqual([]);
    });
    expect(result.current.bookmarks).toEqual([]);
  });

  it('ignores a stale resolved read so a newer book is never overwritten', async () => {
    let resolveSlow!: (value: unknown[]) => void;
    mockListHighlights.mockImplementationOnce(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveSlow = resolve;
        }),
    );
    mockListHighlights.mockResolvedValue([{ id: 'fresh' }]);
    mockListBookmarks.mockResolvedValue([{ id: 'b' }]);

    const { result } = renderHook(() => useReaderAnnotations('book-1'));
    await waitFor(() => {
      expect(mockListHighlights).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.highlights).toEqual([{ id: 'fresh' }]);
    });

    resolveSlow([{ id: 'stale' }]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.highlights).toEqual([{ id: 'fresh' }]);
  });

  it('ignores a stale rejected read so a newer book keeps its rows', async () => {
    let rejectSlow!: (error: unknown) => void;
    mockListHighlights.mockImplementationOnce(
      () =>
        new Promise<unknown[]>((_resolve, reject) => {
          rejectSlow = reject;
        }),
    );
    mockListHighlights.mockResolvedValue([{ id: 'fresh' }]);
    mockListBookmarks.mockResolvedValue([{ id: 'b' }]);

    const { result } = renderHook(() => useReaderAnnotations('book-1'));
    await waitFor(() => {
      expect(mockListHighlights).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => {
      expect(result.current.highlights).toEqual([{ id: 'fresh' }]);
    });

    rejectSlow(new Error('slow failure'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.highlights).toEqual([{ id: 'fresh' }]);
  });
});
