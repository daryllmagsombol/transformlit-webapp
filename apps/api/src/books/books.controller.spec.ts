import { BooksController } from './books.controller';

describe('BooksController', () => {
  const book = { id: 'book-1', pageCount: 2 };

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

  it('creates a reading session for an entitled user', async () => {
    const { controller, sessions } = build();
    const res = { cookie: jest.fn() } as never;
    const result = await controller.createSession('book-1', { user: { id: 'user-1', role: 'MEMBER' } } as never, res);
    expect(sessions.create).toHaveBeenCalledWith('user-1', 'book-1');
    expect(result).toMatchObject({ expiresInMs: expect.any(Number) });
  });

  it('rejects page requests without a session cookie', async () => {
    const { controller } = build();
    await expect(controller.getText('book-1', 1, { cookies: {} } as never)).rejects.toThrow(/session/i);
  });

  it('rejects a session that belongs to a different book', async () => {
    const { controller, sessions } = build();
    sessions.resolve.mockResolvedValue({ sessionId: 's', userId: 'u', bookId: 'other-book' });
    await expect(controller.getText('book-1', 1, { cookies: { transformlit_reader: 't' } } as never)).rejects.toThrow(/session/i);
  });

  it('serves a page frame as image bytes', async () => {
    const frame = Buffer.from('png-bytes');
    const getPageRecord = jest.fn().mockResolvedValue({ assetKey: 'k', textKey: 't', mimeType: 'image/png' });
    const { controller, sessions, storage } = build({ getPageRecord });
    sessions.resolve.mockResolvedValue({ sessionId: 's', userId: 'u', bookId: 'book-1' });
    storage.getBuffer.mockResolvedValue(frame);
    const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() } as never;
    await controller.getFrame('book-1', 1, { cookies: { transformlit_reader: 't' } } as never, res);
    expect(storage.getBuffer).toHaveBeenCalledWith('k');
  });

  it('rate-limits page frame and text requests to 90 per minute', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', BooksController.prototype.getFrame)).toBe(90);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', BooksController.prototype.getText)).toBe(90);
  });
});
