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

  describe('searchUsers', () => {
    it('should search by displayName or email case-insensitive', async () => {
      await service.searchUsers('test');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          OR: [
            { displayName: { contains: 'test', mode: 'insensitive' } },
            { email: { contains: 'test', mode: 'insensitive' } },
          ],
        },
        take: 20,
        orderBy: { displayName: 'asc' },
      });
    });

    it('should exclude deleted users', async () => {
      await service.searchUsers('test');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });

    it('should use default limit of 20', async () => {
      await service.searchUsers('test');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it('should respect custom limit', async () => {
      await service.searchUsers('test', 5);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('should order by displayName ascending', async () => {
      await service.searchUsers('test');
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
    it('should list non-deleted users', async () => {
      await service.listUsers();
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should use default limit of 50', async () => {
      await service.listUsers();
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should respect custom limit', async () => {
      await service.listUsers(10);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('should order by createdAt descending', async () => {
      await service.listUsers();
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });
});
