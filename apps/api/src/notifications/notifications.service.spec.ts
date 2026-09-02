/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const mockNotification = {
  id: 'notif-1',
  userId: 'user-1',
  type: 'NEW_MESSAGE',
  payload: { messageId: 'msg-1' },
  readAt: null,
  createdById: 'user-2',
  createdAt: new Date('2024-06-01'),
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(mockNotification),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();

    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.create.mockResolvedValue(mockNotification);
  });

  // ── listNotifications ──────────────────────────────────────────────────────

  describe('listNotifications', () => {
    it('should find notifications by userId', async () => {
      await service.listNotifications('user-1');
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        }),
      );
    });

    it('should default limit to 50', async () => {
      await service.listNotifications('user-1');
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should use custom limit when provided', async () => {
      await service.listNotifications('user-1', 10);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('should order by createdAt descending', async () => {
      await service.listNotifications('user-1');
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should return notifications array', async () => {
      const notifications = [mockNotification];
      prisma.notification.findMany.mockResolvedValue(notifications);
      const result = await service.listNotifications('user-1');
      expect(result).toEqual(notifications);
    });
  });

  // ── getUnreadCount ─────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('should count notifications where userId and readAt null', async () => {
      await service.getUnreadCount('user-1');
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
    });

    it('should return the count', async () => {
      prisma.notification.count.mockResolvedValue(5);
      const result = await service.getUnreadCount('user-1');
      expect(result).toBe(5);
    });
  });

  // ── markRead ───────────────────────────────────────────────────────────────

  describe('markRead', () => {
    it('should update notification where id, userId, readAt null', async () => {
      await service.markRead('notif-1', 'user-1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('should return true', async () => {
      const result = await service.markRead('notif-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  // ── markAllRead ────────────────────────────────────────────────────────────

  describe('markAllRead', () => {
    it('should update all notifications where userId and readAt null', async () => {
      await service.markAllRead('user-1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('should return true', async () => {
      const result = await service.markAllRead('user-1');
      expect(result).toBe(true);
    });
  });

  // ── createNotification ─────────────────────────────────────────────────────

  describe('createNotification', () => {
    it('should create notification with userId, type, payload, createdById', async () => {
      await service.createNotification('user-1', 'NEW_MESSAGE', { messageId: 'msg-1' }, 'user-2');
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'NEW_MESSAGE',
          payload: { messageId: 'msg-1' },
          createdById: 'user-2',
        },
      });
    });

    it('should return created notification', async () => {
      const result = await service.createNotification('user-1', 'NEW_MESSAGE', { messageId: 'msg-1' }, 'user-2');
      expect(result).toEqual(mockNotification);
    });

    it('should handle undefined payload', async () => {
      await service.createNotification('user-1', 'NEW_MESSAGE');
      const call = prisma.notification.create.mock.calls[0][0];
      expect(call.data.payload).toBeUndefined();
    });

    it('should handle undefined createdById', async () => {
      await service.createNotification('user-1', 'NEW_MESSAGE', { messageId: 'msg-1' });
      const call = prisma.notification.create.mock.calls[0][0];
      expect(call.data.createdById).toBeUndefined();
    });
  });
});
