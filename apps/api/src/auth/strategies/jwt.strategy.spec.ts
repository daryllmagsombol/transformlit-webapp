/// <reference types="jest" />
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: PrismaService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    role: 'MEMBER',
    deletedAt: null,
  };

  beforeEach(() => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockReturnValue('test-jwt-secret'),
    };

    const mockPrismaService = {
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
      },
    };

    strategy = new JwtStrategy(
      mockConfigService as unknown as ConfigService,
      mockPrismaService as unknown as PrismaService,
    );

    prisma = (strategy as any).prisma;
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
  });

  describe('validate', () => {
    it('should find user by sub (id) where deletedAt is null', async () => {
      const payload = { sub: 'user-1' };
      await strategy.validate(payload);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(strategy.validate({ sub: 'nonexistent' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return { id, role } from the found user', async () => {
      const result = await strategy.validate({ sub: 'user-1' });

      expect(result).toEqual({ id: 'user-1', role: 'MEMBER' });
    });

    it('should not return sensitive fields like email', async () => {
      const result = await strategy.validate({ sub: 'user-1' });

      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('deletedAt');
    });

    it('should use payload.sub as the user id', async () => {
      await strategy.validate({ sub: 'custom-user-id' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'custom-user-id' }),
        }),
      );
    });
  });
});
