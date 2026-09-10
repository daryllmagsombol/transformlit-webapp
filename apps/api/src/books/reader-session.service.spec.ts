import { createHash } from 'node:crypto';
import { ReaderSessionService, READER_SESSION_TTL_MS } from './reader-session.service';

describe('ReaderSessionService', () => {
  let prisma: { readingSession: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock } };
  let service: ReaderSessionService;

  beforeEach(() => {
    prisma = { readingSession: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() } };
    service = new ReaderSessionService(prisma as never);
  });

  it('creates a session storing only the token hash', async () => {
    prisma.readingSession.create.mockResolvedValue({ id: 'sess-1' });
    const token = await service.create('user-1', 'book-1');
    expect(typeof token).toBe('string');
    const expected = createHash('sha256').update(token).digest('hex');
    expect(prisma.readingSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', bookId: 'book-1', tokenHash: expected }),
    });
  });

  it('resolves a live session and slides its expiry', async () => {
    prisma.readingSession.findUnique.mockResolvedValue({
      id: 'sess-1', userId: 'user-1', bookId: 'book-1', revokedAt: null, expiresAt: new Date(Date.now() + 60000),
    });
    prisma.readingSession.update.mockResolvedValue({});
    const resolved = await service.resolve('token');
    expect(resolved).toMatchObject({ sessionId: 'sess-1', userId: 'user-1', bookId: 'book-1' });
    expect(prisma.readingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1' },
        data: expect.objectContaining({ lastSeenAt: expect.any(Date), expiresAt: expect.any(Date) }),
      }),
    );
    const slid = prisma.readingSession.update.mock.calls[0][0].data.expiresAt as Date;
    expect(slid.getTime() - Date.now()).toBeGreaterThan(READER_SESSION_TTL_MS - 5000);
  });

  it('rejects an expired session', async () => {
    prisma.readingSession.findUnique.mockResolvedValue({
      id: 'sess-1', userId: 'user-1', bookId: 'book-1', revokedAt: null, expiresAt: new Date(Date.now() - 1000),
    });
    expect(await service.resolve('token')).toBeNull();
  });

  it('rejects a revoked session', async () => {
    prisma.readingSession.findUnique.mockResolvedValue({
      id: 'sess-1', userId: 'user-1', bookId: 'book-1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60000),
    });
    expect(await service.resolve('token')).toBeNull();
  });

  it('revokes every session for a user+book', async () => {
    prisma.readingSession.updateMany.mockResolvedValue({ count: 2 });
    expect(await service.revokeAll('user-1', 'book-1')).toBe(2);
  });
});
