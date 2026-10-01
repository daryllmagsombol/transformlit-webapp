import {
  applyReaderOperation,
  fetchAnnotationSnapshot,
  fetchPageText,
  fetchReadProgress,
  openReadingSession,
  pageFrameUrl,
} from './api';
import { apolloClient, refreshTokens } from '../apollo-client';
import { removeAccessToken, setAccessToken } from '../auth';
import { API_BASE } from '../constants';

jest.mock('../apollo-client', () => ({
  apolloClient: { query: jest.fn(), mutate: jest.fn() },
  refreshTokens: jest.fn(),
}));

describe('reader api', () => {
  const originalFetch = globalThis.fetch;
  const queryMock = apolloClient.query as jest.Mock;
  const mutateMock = apolloClient.mutate as jest.Mock;
  const refreshTokensMock = refreshTokens as jest.Mock;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    removeAccessToken();
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

  it('refreshes the token and retries once when the reading session call is unauthorized', async () => {
    // Mirror production: a successful refresh stores a fresh in-memory token,
    // which the retried POST must re-read via getAccessToken().
    refreshTokensMock.mockImplementation(async () => {
      setAccessToken('refreshed-token');
      return true;
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ expiresInMs: 900000 }) });
    globalThis.fetch = fetchMock as never;

    const result = await openReadingSession('book-1');

    expect(result.expiresInMs).toBe(900000);
    expect(refreshTokensMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer refreshed-token' });
  });

  it('fetches page text JSON with the session cookie', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] }),
    });
    globalThis.fetch = fetchMock as never;
    const text = await fetchPageText('book-1', 1);
    expect(text.items[0].t).toBe('Hello');
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/books/book-1/pages/1/text`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('builds the cookie-authed frame URL', () => {
    expect(pageFrameUrl('book-1', 3)).toBe(`${API_BASE}/books/book-1/pages/3/frame`);
  });

  it('throws on a failed frame fetch', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as never;
    await expect(fetchPageText('book-1', 1)).rejects.toThrow(/401/);
  });

  it('reads the saved revisioned progress so the reader can resume and detect conflicts', async () => {
    queryMock.mockResolvedValue({ data: { readProgress: { currentPage: 7, revision: 3 } } });
    await expect(fetchReadProgress('book-1')).resolves.toEqual({ currentPage: 7, revision: 3 });
  });

  it('returns null when the reader has no saved progress', async () => {
    queryMock.mockResolvedValue({ data: { readProgress: null } });
    await expect(fetchReadProgress('book-1')).resolves.toBeNull();
  });

  it('sends a queued operation through the generated applyBookReaderOperation mutation', async () => {
    mutateMock.mockResolvedValue({ data: { applyBookReaderOperation: { operationId: 'op-1', result: { kind: 'APPLIED' } } } });
    const outcome = await applyReaderOperation({
      bookId: 'book-1',
      contentVersion: 1,
      kind: 'PROGRESS_SET',
      operationId: 'op-1',
      baseRevision: 0,
      currentPage: 12,
      scrollY: null,
    });
    expect(outcome.operationId).toBe('op-1');
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { input: expect.objectContaining({ bookId: 'book-1', currentPage: 12 }) } }),
    );
  });

  it('loads the authoritative annotation snapshot query', async () => {
    queryMock.mockResolvedValue({
      data: { bookReaderAnnotationSnapshot: { bookId: 'book-1', snapshotRevision: 3, annotations: [], tombstones: [], conflictCopies: [] } },
    });
    const snapshot = await fetchAnnotationSnapshot('book-1');
    expect(snapshot.snapshotRevision).toBe(3);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { bookId: 'book-1' }, fetchPolicy: 'no-cache' }),
    );
  });
});
