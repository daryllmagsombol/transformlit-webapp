/// <reference types="jest" />
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('record never throws when the DB write fails', async () => {
    const prisma = { auditLog: { create: jest.fn().mockRejectedValue(new Error('down')) } } as any;
    const service = new AuditService(prisma);
    await expect(service.record({ actorId: 'u1', action: 'LOGIN' })).resolves.toBeUndefined();
  });

  it('list applies every filter and caps pageSize', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { auditLog: { findMany, count } } as any;
    const service = new AuditService(prisma);
    await service.list({ action: 'LOGIN', actorId: 'u1', from: new Date('2026-01-01') }, 1, 500);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ action: 'LOGIN', userId: 'u1' }),
      take: 100,
      orderBy: { createdAt: 'desc' },
    }));
  });

  it('record maps actorId to userId and carries target/ip/userAgent', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } } as any;
    const service = new AuditService(prisma);
    await service.record({
      actorId: 'actor-1',
      action: 'BOOK_UPDATED',
      targetType: 'BOOK',
      targetId: 'book-1',
      payload: { title: 'X' },
      ip: '203.0.113.7',
      userAgent: 'jest',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'actor-1',
        action: 'BOOK_UPDATED',
        targetType: 'BOOK',
        targetId: 'book-1',
        payload: { title: 'X' },
        ipAddress: '203.0.113.7',
        userAgent: 'jest',
      },
    });
  });

  it('list maps targetType/targetId and the full createdAt range', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { auditLog: { findMany, count } } as any;
    const service = new AuditService(prisma);
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-02-01T00:00:00Z');
    await service.list({ targetType: 'BOOK', targetId: 'book-1', from, to }, 1, 25);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { targetType: 'BOOK', targetId: 'book-1', createdAt: { gte: from, lte: to } },
      skip: 0,
      take: 25,
    }));
  });

  it('list paginates and clamps a pageSize below one', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { auditLog: { findMany, count } } as any;
    const service = new AuditService(prisma);
    const result = await service.list({}, 3, 0);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 2, take: 1 }));
    expect(count).toHaveBeenCalledWith({ where: {} });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('list drops explicit null GraphQL filters instead of emitting SQL NULL', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { auditLog: { findMany, count } } as any;
    const service = new AuditService(prisma);
    // GraphQL nullable inputs deliver explicit null for cleared fields.
    await service.list(
      { action: null, actorId: null, targetType: null, targetId: null, from: null, to: null },
      1,
      25,
    );
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({});
    expect(arg.where).not.toHaveProperty('action');
    expect(arg.where).not.toHaveProperty('userId');
    expect(arg.where).not.toHaveProperty('createdAt');
    expect(count).toHaveBeenCalledWith({ where: {} });
  });

  it('list keeps a partial null date range from producing null bounds', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { auditLog: { findMany, count } } as any;
    const service = new AuditService(prisma);
    const from = new Date('2026-01-01T00:00:00Z');
    await service.list({ from, to: null }, 1, 25);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdAt: { gte: from, lte: undefined } },
    }));
  });
});
