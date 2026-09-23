/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  emailNormalized: 'test@example.com',
  displayName: 'Test User',
  bio: 'A bio',
  avatarUrl: null,
  role: 'USER',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
  lastLoginAt: null,
  deletedAt: null,
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
        findMany: jest.fn().mockResolvedValue([mockUser]),
        update: jest.fn().mockResolvedValue(mockUser),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.findMany.mockResolvedValue([mockUser]);
    prisma.user.update.mockResolvedValue(mockUser);
  });

  describe('findById', () => {
    it('should find user by id where deletedAt is null', async () => {
      const result = await service.findById('user-1');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should normalize email to lowercase and trimmed', async () => {
      await service.findByEmail(' Test@Example.com ');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailNormalized: 'test@example.com' },
      });
    });

    it('should find user by emailNormalized', async () => {
      const result = await service.findByEmail('test@example.com');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailNormalized: 'test@example.com' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.findByEmail('nobody@example.com');
      expect(result).toBeNull();
    });
  });

  const PUBLIC_SELECT = {
    id: true,
    displayName: true,
    avatarUrl: true,
    bio: true,
    createdAt: true,
  };

  describe('searchUsers', () => {
    it('should search by displayName case-insensitive only (no email)', async () => {
      await service.searchUsers('test', 'user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          displayName: { contains: 'test', mode: 'insensitive' },
        },
        select: PUBLIC_SELECT,
        take: 20,
        orderBy: { displayName: 'asc' },
      });
    });

    it('should project only public fields (no email)', async () => {
      await service.searchUsers('test', 'user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: PUBLIC_SELECT }),
      );
    });

    it('should exclude deleted users', async () => {
      await service.searchUsers('test', 'user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });

    it('should use default limit of 20', async () => {
      await service.searchUsers('test', 'user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it('should cap limit at 50', async () => {
      await service.searchUsers('test', 'user-1', 999);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should respect custom limit', async () => {
      await service.searchUsers('test', 'user-1', 5);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('should order by displayName ascending', async () => {
      await service.searchUsers('test', 'user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { displayName: 'asc' } }),
      );
    });
  });

  describe('updateProfile', () => {
    it('should update user with provided fields', async () => {
      const input = { displayName: 'New Name', bio: 'New bio' };
      await service.updateProfile('user-1', input);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: input,
      });
    });

    it('should return updated user', async () => {
      const updated = { ...mockUser, displayName: 'New Name' };
      prisma.user.update.mockResolvedValue(updated);
      const result = await service.updateProfile('user-1', { displayName: 'New Name' });
      expect(result).toEqual(updated);
    });
  });

  describe('listUsers', () => {
    it('should list non-deleted users with public projection', async () => {
      await service.listUsers('user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        select: PUBLIC_SELECT,
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should use default limit of 50', async () => {
      await service.listUsers('user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should cap limit at 100', async () => {
      await service.listUsers('user-1', 999);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should respect custom limit', async () => {
      await service.listUsers('user-1', 10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('should order by createdAt descending', async () => {
      await service.listUsers('user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  describe('getProfile', () => {
    const fullUser = {
      ...mockUser,
      role: 'MEMBER',
      status: 'active',
    };

    const setupProfileMocks = (opts: { self?: boolean; acceptedFriend?: boolean } = {}) => {
      prisma.user.findUnique.mockResolvedValue(fullUser);
      prisma.friendship.findFirst.mockResolvedValue(opts.acceptedFriend ? { id: 'f-1' } : null);
      prisma.groupMember.findMany.mockResolvedValue([]);
      prisma.groupMember.count.mockResolvedValue(0);
      prisma.friendship.count.mockResolvedValue(0);
      prisma.bookProgress.findMany.mockResolvedValue([]);
      prisma.bookProgress.count.mockResolvedValue(0);
      prisma.friendship.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);
    };

    beforeEach(() => {
      prisma.friendship = {
        findFirst: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      };
      prisma.groupMember = {
        findMany: jest.fn(),
        count: jest.fn(),
      };
      prisma.bookProgress = {
        findMany: jest.fn(),
        count: jest.fn(),
      };
    });

    it('should expose email and status when viewing own profile', async () => {
      setupProfileMocks({ self: true });
      const result = await service.getProfile('user-1', 'user-1');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.status).toBe('active');
      expect(prisma.friendship.findFirst).not.toHaveBeenCalled();
      // reading progress is loaded for self
      expect(prisma.bookProgress.findMany).toHaveBeenCalled();
      expect(result.bookCount).toBe(0);
    });

    it('should omit email and status when viewing another user', async () => {
      setupProfileMocks({ self: false, acceptedFriend: false });
      const result = await service.getProfile('user-2', 'user-1');
      expect(result.user).not.toHaveProperty('email');
      expect(result.user).not.toHaveProperty('status');
      expect(result.user.id).toBe('user-1');
      expect(result.user.displayName).toBe('Test User');
    });

    it('should gate reading progress for non-friends', async () => {
      setupProfileMocks({ self: false, acceptedFriend: false });
      const result = await service.getProfile('user-2', 'user-1');
      expect(prisma.friendship.findFirst).toHaveBeenCalledWith({
        where: {
          status: 'ACCEPTED',
          OR: [
            { requesterId: 'user-2', addresseeId: 'user-1' },
            { requesterId: 'user-1', addresseeId: 'user-2' },
          ],
        },
      });
      expect(prisma.bookProgress.findMany).not.toHaveBeenCalled();
      expect(prisma.bookProgress.count).not.toHaveBeenCalled();
      expect(result.bookProgress).toEqual([]);
      expect(result.bookCount).toBe(0);
    });

    it('should expose reading progress for accepted friends', async () => {
      setupProfileMocks({ self: false, acceptedFriend: true });
      const progress = [
        { id: 'p-1', userId: 'user-2', bookId: 'b-1', book: { id: 'b-1' }, lastReadAt: new Date() },
      ];
      prisma.bookProgress.findMany.mockResolvedValue(progress);
      prisma.bookProgress.count.mockResolvedValue(1);
      const result = await service.getProfile('user-2', 'user-1');
      expect(result.bookProgress).toEqual(progress);
      expect(result.bookCount).toBe(1);
      // friends still do not see email/status
      expect(result.user).not.toHaveProperty('email');
      expect(result.user).not.toHaveProperty('status');
    });

    it('should throw when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('nope', 'user-1')).rejects.toThrow('User not found');
    });

    it('should produce identical results when concurrent queries resolve out of order', async () => {
      setupProfileMocks({ self: false, acceptedFriend: true });
      const progress = [
        { id: 'p-1', userId: 'user-2', bookId: 'b-1', book: { id: 'b-1' }, lastReadAt: new Date() },
      ];
      prisma.bookProgress.findMany.mockResolvedValue(progress);
      prisma.bookProgress.count.mockResolvedValue(1);
      // Gate resolves last; friend rows + mutual lookup fire in the same wave
      // as the progress reads. Resolve those first to confirm the result does
      // not depend on gate timing.
      prisma.friendship.findFirst.mockResolvedValue(
        new Promise((res) => setTimeout(() => res({ id: 'f-1' }), 5)),
      );
      prisma.friendship.findMany
        .mockResolvedValueOnce([{ requesterId: 'user-1', addresseeId: 'user-3' }])
        .mockResolvedValueOnce([{ requesterId: 'user-3', addresseeId: 'user-2' }]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-3', displayName: 'Mutual', avatarUrl: null, bio: null, createdAt: new Date() },
      ]);

      const result = await service.getProfile('user-2', 'user-1');
      expect(result.bookProgress).toEqual(progress);
      expect(result.bookCount).toBe(1);
      expect(result.mutualFriends).toEqual([
        expect.objectContaining({ id: 'user-3', displayName: 'Mutual' }),
      ]);
      expect(result.groups).toEqual([]);
      expect(result.friendCount).toBe(0);
      expect(result.groupCount).toBe(0);
    });
  });
});
