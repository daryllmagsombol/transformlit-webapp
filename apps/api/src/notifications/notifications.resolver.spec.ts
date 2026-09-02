/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';
import { PubSubService } from './notifications.pubsub.js';

const mockNotification = {
  id: 'notif-1',
  userId: 'user-1',
  type: 'NEW_MESSAGE',
  payload: { messageId: 'msg-1' },
  readAt: null,
  createdById: 'user-2',
  createdAt: new Date('2024-06-01'),
};

const mockUser = { id: 'user-1' };

describe('NotificationsResolver', () => {
  let resolver: NotificationsResolver;
  let notificationsService: Record<string, jest.Mock>;
  let pubSub: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockNotificationsService = {
      listNotifications: jest.fn().mockResolvedValue([mockNotification]),
      getUnreadCount: jest.fn().mockResolvedValue(3),
      markRead: jest.fn().mockResolvedValue(true),
      markAllRead: jest.fn().mockResolvedValue(true),
    };

    const mockPubSub = {
      asyncIterator: jest.fn(),
      publish: jest.fn(),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsResolver,
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: PubSubService, useValue: mockPubSub },
      ],
    }).compile();

    resolver = module.get<NotificationsResolver>(NotificationsResolver);
    notificationsService = module.get(NotificationsService) as any;
    pubSub = module.get(PubSubService) as any;
    jest.clearAllMocks();
  });

  // ── notifications query ────────────────────────────────────────────────────

  describe('notifications', () => {
    it('should delegate to listNotifications with user id and limit', async () => {
      const result = await resolver.notifications(mockUser, 10);
      expect(notificationsService.listNotifications).toHaveBeenCalledWith('user-1', 10);
      expect(result).toEqual([mockNotification]);
    });

    it('should use default limit of 50', async () => {
      await resolver.notifications(mockUser, 50);
      expect(notificationsService.listNotifications).toHaveBeenCalledWith('user-1', 50);
    });
  });

  // ── unreadNotificationCount query ──────────────────────────────────────────

  describe('unreadNotificationCount', () => {
    it('should delegate to getUnreadCount with user id', async () => {
      const result = await resolver.unreadNotificationCount(mockUser);
      expect(notificationsService.getUnreadCount).toHaveBeenCalledWith('user-1');
      expect(result).toBe(3);
    });
  });

  // ── markNotificationRead mutation ──────────────────────────────────────────

  describe('markNotificationRead', () => {
    it('should delegate to markRead with notificationId and user id', async () => {
      const result = await resolver.markNotificationRead(mockUser, 'notif-1');
      expect(notificationsService.markRead).toHaveBeenCalledWith('notif-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  // ── markAllNotificationsRead mutation ──────────────────────────────────────

  describe('markAllNotificationsRead', () => {
    it('should delegate to markAllRead with user id', async () => {
      const result = await resolver.markAllNotificationsRead(mockUser);
      expect(notificationsService.markAllRead).toHaveBeenCalledWith('user-1');
      expect(result).toBe(true);
    });
  });

  describe('notificationReceived subscription', () => {
    it('should return asyncIterator for notificationReceived', () => {
      const mockIterator = { next: jest.fn(), return: jest.fn(), throw: jest.fn() };
      pubSub.asyncIterator.mockReturnValue(mockIterator);

      const result = resolver.notificationReceived('user-1');

      expect(pubSub.asyncIterator).toHaveBeenCalledWith('notificationReceived');
      expect(result).toBe(mockIterator);
    });
  });
});
