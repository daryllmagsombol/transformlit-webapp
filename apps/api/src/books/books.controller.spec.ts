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
    return { controller: new BooksController(books as never, sessions as never, storage as never, views as never), books, sessions, storage, views };
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
    expect(cookie).toHaveBeenCalledWith(
      'transformlit_reader',
      'raw-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/books' }),
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
});
