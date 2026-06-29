/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { FriendsService } from './friends.service';
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
    prisma = module.get(PrismaService);
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
