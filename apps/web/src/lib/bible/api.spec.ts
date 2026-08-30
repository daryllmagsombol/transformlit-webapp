import { fetchBible, getBooks, getChapter, getCrossReferences, clearBibleCache } from './api';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200, etag?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(etag ? { etag } : {}),
  } as Response;
}

describe('fetchBible', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearBibleCache();
  });

  it('fetches and caches by URL with etag', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }, 200, 'W/"abc"'));
    const first = await fetchBible<{ ok: boolean }>('/api/BSB/books.json');
    expect(first.ok).toBe(true);

    // second call uses cache, revalidates with If-None-Match
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 304));
    const second = await fetchBible<{ ok: boolean }>('/api/BSB/books.json');
    expect(second.ok).toBe(true);
    expect(mockFetch.mock.calls[1][1]?.headers).toEqual({ 'If-None-Match': 'W/"abc"' });
  });

  it('dedupes concurrent requests for the same url', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }, 200, 'W/"x"'));
    const [a, b] = await Promise.all([
      fetchBible('/api/BSB/books.json'),
      fetchBible('/api/BSB/books.json'),
    ]);
    expect(a).toEqual(b);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('typed getters', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('getBooks hits /api/{t}/books.json', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ books: [{ id: 'GEN' }] }));
    const result = await getBooks('BSB');
    expect(result.books[0].id).toBe('GEN');
    expect(mockFetch.mock.calls[0][0]).toBe('https://bible.helloao.org/api/BSB/books.json');
  });

  it('getChapter hits /api/{t}/{b}/{c}.json', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ chapter: { number: 1 } }));
    const result = await getChapter('BSB', 'GEN', 1);
    expect(result.chapter.number).toBe(1);
  });

  it('getCrossReferences hits the dataset route', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ chapter: { number: 12, content: [] } }));
    const result = await getCrossReferences('ROM', 12);
    expect(result.chapter.number).toBe(12);
    expect(mockFetch.mock.calls[0][0]).toBe('https://bible.helloao.org/api/d/open-cross-ref/ROM/12.json');
  });
});