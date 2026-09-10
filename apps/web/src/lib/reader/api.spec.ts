import { fetchPageText, fetchReadProgress, openReadingSession, saveReaderProgress } from './api';
import { apolloClient } from '../apollo-client';

jest.mock('../apollo-client', () => ({
  apolloClient: { query: jest.fn(), mutate: jest.fn() },
}));

describe('reader api', () => {
  const originalFetch = globalThis.fetch;
  const queryMock = apolloClient.query as jest.Mock;
  const mutateMock = apolloClient.mutate as jest.Mock;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('opens a reading session with credentials included', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ expiresInMs: 900000 }) });
    globalThis.fetch = fetchMock as never;
    const result = await openReadingSession('book-1');
    expect(result.expiresInMs).toBe(900000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/books/book-1/reading-session'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('fetches page text JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] }),
    }) as never;
    const text = await fetchPageText('book-1', 1);
    expect(text.items[0].t).toBe('Hello');
  });

  it('throws on a failed frame fetch', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as never;
    await expect(fetchPageText('book-1', 1)).rejects.toThrow(/401/);
  });

  it('reads the saved page so the reader can resume', async () => {
    queryMock.mockResolvedValue({ data: { readProgress: { currentPage: 7 } } });
    await expect(fetchReadProgress('book-1')).resolves.toEqual({ currentPage: 7 });
  });

  it('returns null when the reader has no saved progress', async () => {
    queryMock.mockResolvedValue({ data: { readProgress: null } });
    await expect(fetchReadProgress('book-1')).resolves.toBeNull();
  });

  it('persists the current page through the saveProgress mutation', async () => {
    mutateMock.mockResolvedValue({ data: { saveProgress: { currentPage: 12 } } });
    await saveReaderProgress('book-1', 12);
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { input: { bookId: 'book-1', currentPage: 12 } } }),
    );
  });
});
