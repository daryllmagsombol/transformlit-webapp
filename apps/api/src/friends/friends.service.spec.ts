/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { FriendsService } from './friends.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PubSubService } from '../chat/pubsub.service';
import { PrismaService } from '../prisma/prisma.service';

const mockFriendship = {
  id: 'friendship-1',
  requesterId: 'user-1',
  addresseeId: 'user-2',
  status: 'PENDING',
  createdAt: new Date('2024-01-01'),
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
};

const mockUser2 = {
  id: 'user-2',
  email: 'test2@example.com',
  displayName: 'Test User 2',
};

describe('FriendsService', () => {
  let service: FriendsService;
  let prisma: any;
  let notificationsService: any;
  let pubSub: any;

  beforeEach(async () => {
    const mockPrisma = {
      friendship: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(mockFriendship),
        create: jest.fn().mockResolvedValue(mockFriendship),
        update: jest.fn().mockResolvedValue({ ...mockFriendship, status: 'ACCEPTED' }),
        delete: jest.fn().mockResolvedValue(mockFriendship),
      },
    };

    const mockNotifications = {
      createNotification: jest.fn().mockResolvedValue({}),
    };

    const mockPubSub = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: PubSubService, useValue: mockPubSub },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
    prisma = module.get(PrismaService);
    notificationsService = module.get(NotificationsService);
    pubSub = module.get(PubSubService);
    jest.clearAllMocks();

    prisma.friendship.findMany.mockResolvedValue([]);
    prisma.friendship.findUnique.mockResolvedValue(mockFriendship);
    prisma.friendship.create.mockResolvedValue(mockFriendship);
    prisma.friendship.update.mockResolvedValue({ ...mockFriendship, status: 'ACCEPTED' });
    prisma.friendship.delete.mockResolvedValue(mockFriendship);
  });

  // ── listFriends ─────────────────────────────────────────────────────────────

  describe('listFriends', () => {
    it('should find friendships where user is requester OR addressee', async () => {
      await service.listFriends('user-1');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ requesterId: 'user-1' }, { addresseeId: 'user-1' }],
            status: 'ACCEPTED',
          },
        }),
      );
    });

    it('should filter by status = ACCEPTED', async () => {
      await service.listFriends('user-1');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACCEPTED' }),
        }),
      );
    });

    it('should include requester and addressee user objects', async () => {
      await service.listFriends('user-1');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { requester: true, addressee: true },
        }),
      );
    });

    it('should order by createdAt descending', async () => {
      await service.listFriends('user-1');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should return friendships array', async () => {
      const friendships = [
        { ...mockFriendship, requester: mockUser, addressee: mockUser2 },
      ];
      prisma.friendship.findMany.mockResolvedValue(friendships);
      const result = await service.listFriends('user-1');
      expect(result).toEqual(friendships);
    });
  });

  // ── listRequests ────────────────────────────────────────────────────────────

  describe('listRequests', () => {
    it('should find friendships where addresseeId = userId', async () => {
      await service.listRequests('user-2');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { addresseeId: 'user-2', status: 'PENDING' },
        }),
      );
    });

    it('should filter by status = PENDING', async () => {
      await service.listRequests('user-2');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });

    it('should include requester user object', async () => {
      await service.listRequests('user-2');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { requester: true },
        }),
      );
    });

    it('should order by createdAt descending', async () => {
      await service.listRequests('user-2');
      expect(prisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should return requests array', async () => {
      const requests = [{ ...mockFriendship, requester: mockUser }];
      prisma.friendship.findMany.mockResolvedValue(requests);
      const result = await service.listRequests('user-2');
      expect(result).toEqual(requests);
    });
  });

  // ── sendRequest ─────────────────────────────────────────────────────────────

  describe('sendRequest', () => {
    it('should throw Error if requesterId === addresseeId', async () => {
      await expect(service.sendRequest('user-1', 'user-1')).rejects.toThrow(
        'Cannot friend yourself',
      );
    });

    it('should not call create if requesterId === addresseeId', async () => {
      await expect(service.sendRequest('user-1', 'user-1')).rejects.toThrow();
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });

    it('should throw Error if friendship already exists', async () => {
      prisma.friendship.findUnique.mockResolvedValue(mockFriendship);
      await expect(service.sendRequest('user-1', 'user-2')).rejects.toThrow(
        'Friendship already exists',
      );
    });

    it('should check existing friendship with composite key', async () => {
      prisma.friendship.findUnique.mockResolvedValue(null);
      await service.sendRequest('user-1', 'user-2');
      expect(prisma.friendship.findUnique).toHaveBeenCalledWith({
        where: { requesterId_addresseeId: { requesterId: 'user-1', addresseeId: 'user-2' } },
      });
    });

    it('should create friendship with status PENDING', async () => {
      prisma.friendship.findUnique.mockResolvedValue(null);
      await service.sendRequest('user-1', 'user-2');
      expect(prisma.friendship.create).toHaveBeenCalledWith({
        data: { requesterId: 'user-1', addresseeId: 'user-2', status: 'PENDING' },
      });
    });

    it('should return created friendship', async () => {
      prisma.friendship.findUnique.mockResolvedValue(null);
      const result = await service.sendRequest('user-1', 'user-2');
      expect(result).toEqual(mockFriendship);
    });
  });

  // ── acceptRequest ───────────────────────────────────────────────────────────

  describe('acceptRequest', () => {
    it('should throw Error if friendship not found', async () => {
      prisma.friendship.findUnique.mockResolvedValue(null);
      await expect(service.acceptRequest('bad-id', 'user-2')).rejects.toThrow(
        'Not authorized',
      );
    });

    it('should throw Error if addresseeId !== userId', async () => {
      prisma.friendship.findUnique.mockResolvedValue(mockFriendship);
      await expect(service.acceptRequest('friendship-1', 'user-3')).rejects.toThrow(
        'Not authorized',
      );
    });

    it('should update status to ACCEPTED', async () => {
      await service.acceptRequest('friendship-1', 'user-2');
      expect(prisma.friendship.update).toHaveBeenCalledWith({
        where: { id: 'friendship-1' },
        data: { status: 'ACCEPTED' },
      });
    });

    it('should return updated friendship', async () => {
      const accepted = { ...mockFriendship, status: 'ACCEPTED' };
      prisma.friendship.update.mockResolvedValue(accepted);
      const result = await service.acceptRequest('friendship-1', 'user-2');
      expect(result).toEqual(accepted);
    });
  });

  // ── rejectRequest ───────────────────────────────────────────────────────────

  describe('rejectRequest', () => {
    it('should throw Error if friendship not found', async () => {
      prisma.friendship.findUnique.mockResolvedValue(null);
      await expect(service.rejectRequest('bad-id', 'user-2')).rejects.toThrow(
        'Not authorized',
      );
    });

    it('should throw Error if addresseeId !== userId', async () => {
      prisma.friendship.findUnique.mockResolvedValue(mockFriendship);
      await expect(service.rejectRequest('friendship-1', 'user-3')).rejects.toThrow(
        'Not authorized',
      );
    });

    it('should update status to REJECTED', async () => {
      await service.rejectRequest('friendship-1', 'user-2');
      expect(prisma.friendship.update).toHaveBeenCalledWith({
        where: { id: 'friendship-1' },
        data: { status: 'REJECTED' },
      });
    });

    it('should return updated friendship', async () => {
      const rejected = { ...mockFriendship, status: 'REJECTED' };
      prisma.friendship.update.mockResolvedValue(rejected);
      const result = await service.rejectRequest('friendship-1', 'user-2');
      expect(result).toEqual(rejected);
    });
  });

  // ── removeFriend ────────────────────────────────────────────────────────────

  describe('removeFriend', () => {
    it('should delete friendship by id', async () => {
      await service.removeFriend('friendship-1');
      expect(prisma.friendship.delete).toHaveBeenCalledWith({
        where: { id: 'friendship-1' },
      });
    });

    it('should return deleted friendship', async () => {
      const result = await service.removeFriend('friendship-1');
      expect(result).toEqual(mockFriendship);
    });
  });
});

// ── FriendsService - notifications ─────────────────────────────────────────

describe('FriendsService - notifications', () => {
  let service: FriendsService;
  let notificationsService: any;
  let pubSub: any;
  let prisma: any;

  const mockPrisma = {
    friendship: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  };

  const mockPubSub = {
    publish: jest.fn(),
    asyncIterator: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
        { provide: PubSubService, useValue: mockPubSub },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
    notificationsService = module.get(NotificationsService);
    prisma = module.get(PrismaService);
    pubSub = module.get(PubSubService);
    jest.clearAllMocks();
  });

  it('should create a FRIEND_REQUEST notification after sending a request', async () => {
    const friendship = { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'PENDING' };
    mockPrisma.friendship.findUnique.mockResolvedValue(null);
    mockPrisma.friendship.create.mockResolvedValue(friendship);
    (notificationsService.createNotification as jest.Mock).mockResolvedValue({});

    await service.sendRequest('u1', 'u2');

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'u2', 'FRIEND_REQUEST', { friendshipId: 'f1' }, 'u1'
    );
  });

  it('should publish notification after sending a request', async () => {
    const friendship = { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'PENDING' };
    const notification = { id: 'notif-1', type: 'FRIEND_REQUEST' };
    mockPrisma.friendship.findUnique.mockResolvedValue(null);
    mockPrisma.friendship.create.mockResolvedValue(friendship);
    (notificationsService.createNotification as jest.Mock).mockResolvedValue(notification);

    await service.sendRequest('u1', 'u2');

    expect(pubSub.publish).toHaveBeenCalledWith('notificationReceived', {
      notificationReceived: notification,
      userId: 'u2',
    });
  });

  it('should create a FRIEND_ACCEPTED notification after accepting a request', async () => {
    const friendship = { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'PENDING' };
    mockPrisma.friendship.findUnique.mockResolvedValue(friendship);
    mockPrisma.friendship.update.mockResolvedValue({ ...friendship, status: 'ACCEPTED' });
    (notificationsService.createNotification as jest.Mock).mockResolvedValue({});

    await service.acceptRequest('f1', 'u2');

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'u1', 'FRIEND_ACCEPTED', { friendshipId: 'f1' }, 'u2'
    );
  });

  it('should publish notification after accepting a request', async () => {
    const friendship = { id: 'f1', requesterId: 'u1', addresseeId: 'u2', status: 'PENDING' };
    const notification = { id: 'notif-2', type: 'FRIEND_ACCEPTED' };
    mockPrisma.friendship.findUnique.mockResolvedValue(friendship);
    mockPrisma.friendship.update.mockResolvedValue({ ...friendship, status: 'ACCEPTED' });
    (notificationsService.createNotification as jest.Mock).mockResolvedValue(notification);

    await service.acceptRequest('f1', 'u2');

    expect(pubSub.publish).toHaveBeenCalledWith('notificationReceived', {
      notificationReceived: notification,
      userId: 'u1',
    });
  });

  it('should throw on self-friend request before creating notification', async () => {
    await expect(service.sendRequest('u1', 'u1')).rejects.toThrow('Cannot friend yourself');
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
    expect(pubSub.publish).not.toHaveBeenCalled();
  });

  it('should throw on duplicate friend request before creating notification', async () => {
    mockPrisma.friendship.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.sendRequest('u1', 'u2')).rejects.toThrow('Friendship already exists');
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
    expect(pubSub.publish).not.toHaveBeenCalled();
  });
});
