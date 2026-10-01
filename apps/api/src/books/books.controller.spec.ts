import { BooksController } from './books.controller';

describe('BooksController', () => {
  const book = { id: 'book-1', pageCount: 2, contentVersion: 1 };
  const session = { sessionId: 's', userId: 'u', bookId: 'book-1' };

  function build(overrides: Record<string, unknown> = {}) {
    const books = {
      assertCanRead: jest.fn().mockResolvedValue(book),
      ...overrides,
    };
    const sessions = { create: jest.fn().mockResolvedValue('raw-token'), resolve: jest.fn() };
    const storage = { getBuffer: jest.fn(), getStream: jest.fn() };
    const views = { record: jest.fn().mockResolvedValue(undefined) };
    const downloads = { getManifest: jest.fn(), getAsset: jest.fn(), getAssetById: jest.fn() };
    return { controller: new BooksController(books as never, sessions as never, storage as never, views as never, downloads as never), books, sessions, storage, views, downloads };
  }

  const authed = { user: { id: 'user-1', role: 'MEMBER' } } as never;
  const withCookie = { cookies: { transformlit_reader: 't' } } as never;

  it('creates a reading session for an entitled user', async () => {
    const { controller, sessions } = build();
    const res = { cookie: jest.fn() } as never;
    const result = await controller.createSession('book-1', authed, res);
    expect(sessions.create).toHaveBeenCalledWith('user-1', 'book-1');
    expect(result).toMatchObject({ expiresInMs: expect.any(Number) });
  });

  it('sets a scoped, httpOnly cookie with no fixed maxAge', async () => {
    const { controller } = build();
    const cookie = jest.fn();
    await controller.createSession('book-1', authed, { cookie } as never);
    // `path` must be `/` so the cookie is sent to the deployed `/api/books/...`
    // page routes; `/books` would leave every frame/text read unauthenticated.
    expect(cookie).toHaveBeenCalledWith(
      'transformlit_reader',
      'raw-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
    );
    const options = cookie.mock.calls[0][2] as Record<string, unknown>;
    expect(options).not.toHaveProperty('maxAge');
    expect(typeof options.secure).toBe('boolean');
  });

  it('rejects page requests without a session cookie', async () => {
    const { controller } = build();
    await expect(
      controller.getText('book-1', 1, { cookies: {} } as never, { setHeader: jest.fn() } as never),
    ).rejects.toThrow(/session/i);
  });

  it('rejects a session that belongs to a different book', async () => {
    const { controller, sessions } = build();
    sessions.resolve.mockResolvedValue({ sessionId: 's', userId: 'u', bookId: 'other-book' });
    await expect(
      controller.getText('book-1', 1, withCookie, { setHeader: jest.fn() } as never),
    ).rejects.toThrow(/session/i);
  });

  it('serves a page frame as image bytes with hardened headers', async () => {
    const frame = Buffer.from('png-bytes');
    const getPageRecord = jest.fn().mockResolvedValue({ assetKey: 'k', textKey: 't', mimeType: 'image/png' });
    const { controller, sessions, storage, views } = build({ getPageRecord });
    sessions.resolve.mockResolvedValue(session);
    storage.getBuffer.mockResolvedValue(frame);
    const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() };
    await controller.getFrame('book-1', 1, withCookie, res as never);
    expect(storage.getBuffer).toHaveBeenCalledWith('k');
    expect(res.type).toHaveBeenCalledWith('image/png');
    expect(res.send).toHaveBeenCalledWith(frame);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Cookie');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline');
    expect(views.record).toHaveBeenCalledWith(session, 1, 1);
  });

  it('records a page view only on the frame endpoint', async () => {
    const getPageRecord = jest.fn().mockResolvedValue({ assetKey: 'k', textKey: 't', mimeType: 'image/png' });
    const { controller, sessions, storage, views } = build({ getPageRecord });
    sessions.resolve.mockResolvedValue(session);
    storage.getBuffer.mockResolvedValue(Buffer.from('{"items":[]}'));
    await controller.getFrame('book-1', 1, withCookie, { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() } as never);
    expect(views.record).toHaveBeenCalledTimes(1);
    await controller.getText('book-1', 1, withCookie, { setHeader: jest.fn() } as never);
    expect(views.record).toHaveBeenCalledTimes(1);
  });

  it('hardens the page text response with no-store headers', async () => {
    const getPageRecord = jest.fn().mockResolvedValue({ assetKey: 'k', textKey: 't', mimeType: 'image/png' });
    const { controller, sessions, storage } = build({ getPageRecord });
    sessions.resolve.mockResolvedValue(session);
    storage.getBuffer.mockResolvedValue(Buffer.from('{"items":[]}'));
    const res = { setHeader: jest.fn() };

    await expect(controller.getText('book-1', 1, withCookie, res as never)).resolves.toEqual({ items: [] });

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Cookie');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });

  it('does not fail a page read when analytics rejects', async () => {
    const getPageRecord = jest.fn().mockResolvedValue({ assetKey: 'k', textKey: 't', mimeType: 'image/png' });
    const { controller, sessions, storage, views } = build({ getPageRecord });
    sessions.resolve.mockResolvedValue(session);
    storage.getBuffer.mockResolvedValue(Buffer.from('png'));
    views.record.mockRejectedValue(new Error('analytics down'));
    const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() };
    await expect(controller.getFrame('book-1', 1, withCookie, res as never)).resolves.toBeUndefined();
    expect(res.send).toHaveBeenCalledWith(Buffer.from('png'));
  });

  it('rate-limits page frame and text requests to 90 per minute', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', BooksController.prototype.getFrame)).toBe(90);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', BooksController.prototype.getText)).toBe(90);
  });

  describe('offline downloads', () => {
    const manifest = {
      contractVersion: 1,
      bookId: 'book-1',
      contentVersion: 2,
      title: 'Pinned',
      author: null,
      description: null,
      coverAssetId: null,
      totalPages: 1,
      toc: [],
      pages: [],
      assets: [],
    };

    function buildDownloads(overrides: Record<string, unknown> = {}) {
      const downloads = {
        getManifest: jest.fn().mockResolvedValue(manifest),
        getAsset: jest.fn().mockResolvedValue({
          buffer: Buffer.from('bytes'),
          mediaType: 'image/png',
          byteLength: 5,
          sha256: 'a'.repeat(64),
        }),
        getAssetById: jest.fn().mockResolvedValue({
          buffer: Buffer.from('bytes'),
          mediaType: 'image/png',
          byteLength: 5,
          sha256: 'a'.repeat(64),
          kind: 'frame',
          pageNumber: 1,
        }),
        ...overrides,
      };
      const base = build();
      const controller = new BooksController(
        base.books as never,
        base.sessions as never,
        base.storage as never,
        base.views as never,
        downloads as never,
      );
      return { ...base, controller, downloads };
    }

    it('serves the manifest with bearer auth, current access, and no-store headers', async () => {
      const { controller, downloads } = buildDownloads();
      const res = { setHeader: jest.fn() };
      const result = await controller.getOfflineManifest('book-1', 2, authed, res as never);
      expect(downloads.getManifest).toHaveBeenCalledWith('book-1', 'user-1', 2);
      expect(result).toBe(manifest);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
      expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization');
    });

    it('defaults to the latest retained version when no version is supplied', async () => {
      const { controller, downloads } = buildDownloads();
      await controller.getOfflineManifest('book-1', undefined, authed, { setHeader: jest.fn() } as never);
      expect(downloads.getManifest).toHaveBeenCalledWith('book-1', 'user-1', undefined);
    });

    it('streams a pinned frame with length, type and sha256 ETag', async () => {
      const { controller, downloads } = buildDownloads();
      const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() };
      await controller.getOfflineFrame('book-1', 2, 1, authed, res as never);
      expect(downloads.getAsset).toHaveBeenCalledWith('book-1', 'user-1', 2, 1, 'frame');
      expect(res.type).toHaveBeenCalledWith('image/png');
      expect(res.send).toHaveBeenCalledWith(Buffer.from('bytes'));
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 5);
      expect(res.setHeader).toHaveBeenCalledWith('ETag', `"sha256-${'a'.repeat(64)}"`);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
      expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization');
      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    });

    it('serves the exact empty text-layer bytes as a download asset', async () => {
      const { controller } = buildDownloads({
        getAsset: jest.fn().mockResolvedValue({
          buffer: Buffer.from('{"items":[]}'),
          mediaType: 'application/json',
          byteLength: 12,
          sha256: 'b'.repeat(64),
        }),
      });
      const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() };
      await controller.getOfflineText('book-1', 2, 1, authed, res as never);
      expect(res.send).toHaveBeenCalledWith(Buffer.from('{"items":[]}'));
      expect(res.type).toHaveBeenCalledWith('application/json');
    });

    it('resolves a version-pinned asset by its opaque asset id', async () => {
      const { controller, downloads } = buildDownloads();
      const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() };
      await controller.getOfflineAsset('book-1', 2, 'page-1:text', authed, res as never);
      expect(downloads.getAssetById).toHaveBeenCalledWith('book-1', 'user-1', 2, 'page-1:text');
      expect(res.send).toHaveBeenCalledWith(Buffer.from('bytes'));
    });

    it('never creates reading sessions or page-view analytics for downloads', async () => {
      const { controller, sessions, views } = buildDownloads();
      await controller.getOfflineManifest('book-1', 2, authed, { setHeader: jest.fn() } as never);
      await controller.getOfflineFrame('book-1', 2, 1, authed, { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() } as never);
      expect(sessions.create).not.toHaveBeenCalled();
      expect(views.record).not.toHaveBeenCalled();
    });

    it('keeps offline routes on their own bounded throttle, separate from page routes', () => {
      expect(Reflect.getMetadata('THROTTLER:LIMITdownload', BooksController.prototype.getOfflineManifest)).toBe(30);
      expect(Reflect.getMetadata('THROTTLER:LIMITdownload', BooksController.prototype.getOfflineFrame)).toBe(30);
      expect(Reflect.getMetadata('THROTTLER:LIMITdownload', BooksController.prototype.getOfflineText)).toBe(30);
      expect(Reflect.getMetadata('THROTTLER:LIMITdownload', BooksController.prototype.getOfflineAsset)).toBe(30);
    });
  });
});
