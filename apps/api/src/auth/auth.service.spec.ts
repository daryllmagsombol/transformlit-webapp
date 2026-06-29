/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn((size: number) => {
    if (size === 40) return Buffer.from('mock-refresh-raw-40bytes-padding!!');
    return Buffer.from('mock-family-16bytes!');
  }),
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'mock-token-hash'),
  })),
}));

import * as argon2 from 'argon2';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  emailNormalized: 'test@example.com',
  displayName: 'Test User',
  passwordHash: 'hashed-password',
  role: 'USER',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
  lastLoginAt: null,
  deletedAt: null,
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;

  const mockTx = {
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  beforeEach(async () => {
    const mockPrisma = {
      user: {
        create: jest.fn().mockResolvedValue(mockUser),
        findUnique: jest.fn().mockResolvedValue(mockUser),
        update: jest.fn().mockResolvedValue(mockUser),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      identity: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: any) => cb(mockTx)),
    };

    const mockJwtService = {
      sign: jest.fn(() => 'mock-access-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);

    jest.clearAllMocks();
    prisma.user.create.mockResolvedValue(mockUser);
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue(mockUser);
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.refreshToken.update.mockResolvedValue({});
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    mockTx.refreshToken.create.mockResolvedValue({});
    mockTx.refreshToken.update.mockResolvedValue({});
    jwtService.sign.mockReturnValue('mock-access-token');
  });

  describe('registerLocal', () => {
    const input = { email: ' Test@Example.com ', password: 'password123', displayName: 'Test' };

    it('should hash password with argon2', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      await service.registerLocal(input);
      expect(argon2.hash).toHaveBeenCalledWith('password123');
    });

    it('should normalize email to lowercase and trimmed', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      await service.registerLocal(input);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            emailNormalized: 'test@example.com',
          }),
        }),
      );
    });

    it('should preserve original email in user data', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      await service.registerLocal(input);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: ' Test@Example.com ',
          }),
        }),
      );
    });

    it('should create user in prisma', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      await service.registerLocal(input);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordHash: 'hashed-pw',
            displayName: 'Test',
          }),
        }),
      );
    });

    it('should generate JWT access token', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      await service.registerLocal(input);
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-1' });
    });

    it('should create refresh token in database', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      await service.registerLocal(input);
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tokenHash: 'mock-token-hash',
          }),
        }),
      );
    });

    it('should return accessToken, refreshToken, and user', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      const result = await service.registerLocal(input);
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
        user: mockUser,
      });
    });

    it('should propagate Prisma unique constraint errors', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-pw');
      const error = new Error('Unique constraint') as any;
      error.code = 'P2002';
      prisma.user.create.mockRejectedValue(error);
      await expect(service.registerLocal(input)).rejects.toThrow('Unique constraint');
    });
  });

  describe('loginLocal', () => {
    const input = { email: 'test@example.com', password: 'password123' };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
    });

    it('should normalize email for lookup', async () => {
      await service.loginLocal({ email: ' TEST@Example.com ', password: 'password123' });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { emailNormalized: 'test@example.com' },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.loginLocal(input)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user has no passwordHash (OAuth user)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash: null });
      await expect(service.loginLocal(input)).rejects.toThrow(UnauthorizedException);
    });

    it('should verify password with argon2', async () => {
      await service.loginLocal(input);
      expect(argon2.verify).toHaveBeenCalledWith('hashed-password', 'password123');
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(false);
      await expect(service.loginLocal(input)).rejects.toThrow(UnauthorizedException);
    });

    it('should update lastLoginAt on successful login', async () => {
      await service.loginLocal(input);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });

    it('should generate and return tokens', async () => {
      const result = await service.loginLocal(input);
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
        user: mockUser,
      });
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'user-1' });
    });
  });

  describe('refreshTokens', () => {
    const validStored = {
      id: 'rt-1',
      userId: 'user-1',
      familyId: 'family-1',
      tokenHash: 'mock-token-hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    };

    beforeEach(() => {
      prisma.refreshToken.findUnique.mockResolvedValue(validStored);
    });

    it('should hash the refresh token with SHA-256', async () => {
      await service.refreshTokens('some-refresh-token');
      expect(require('node:crypto').createHash).toHaveBeenCalledWith('sha256');
    });

    it('should find refresh token by hash', async () => {
      await service.refreshTokens('some-refresh-token');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'mock-token-hash' },
      });
    });

    it('should throw UnauthorizedException if token not found', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if token is revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validStored,
        revokedAt: new Date(),
      });
      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if token is expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validStored,
        expiresAt: new Date(Date.now() - 86400000),
      });
      await expect(service.refreshTokens('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should revoke entire token family when revoked token is reused', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validStored,
        revokedAt: new Date(),
      });
      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should not revoke family when token is simply not found', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens('bad-token')).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('should revoke old token in transaction', async () => {
      await service.refreshTokens('valid-token');
      expect(mockTx.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('should create new tokens in transaction with same familyId', async () => {
      await service.refreshTokens('valid-token');
      expect(mockTx.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            familyId: 'family-1',
          }),
        }),
      );
    });

    it('should return new accessToken, refreshToken, and user', async () => {
      const result = await service.refreshTokens('valid-token');
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
        user: mockUser,
      });
    });
  });

  describe('findOrCreateOAuthUser', () => {
    const profile = {
      provider: 'google',
      providerId: 'google-123',
      email: 'oauth@example.com',
      displayName: 'OAuth User',
    };

    it('should find existing identity by provider + providerId', async () => {
      const existingIdentity = { id: 'id-1', userId: 'user-1', user: mockUser };
      prisma.identity.findUnique.mockResolvedValue(existingIdentity);

      await service.findOrCreateOAuthUser(profile);

      expect(prisma.identity.findUnique).toHaveBeenCalledWith({
        where: {
          provider_providerId: {
            provider: 'google',
            providerId: 'google-123',
          },
        },
        include: { user: true },
      });
    });

    it('should update lastLoginAt and return tokens for existing identity', async () => {
      const existingIdentity = { id: 'id-1', userId: 'user-1', user: mockUser };
      prisma.identity.findUnique.mockResolvedValue(existingIdentity);

      const result = await service.findOrCreateOAuthUser(profile);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
        user: mockUser,
      });
    });

    it('should create new user + identity when identity not found', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);

      await service.findOrCreateOAuthUser(profile);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'oauth@example.com',
            emailNormalized: 'oauth@example.com',
            displayName: 'OAuth User',
          }),
        }),
      );
      expect(prisma.identity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            provider: 'google',
            providerId: 'google-123',
            email: 'oauth@example.com',
          }),
        }),
      );
    });

    it('should return tokens for newly created OAuth user', async () => {
      prisma.identity.findUnique.mockResolvedValue(null);

      const result = await service.findOrCreateOAuthUser(profile);

      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: expect.any(String),
        user: mockUser,
      });
    });
  });

  describe('validateUser', () => {
    it('should find user by id where deletedAt is null', async () => {
      const result = await service.validateUser('user-1');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.validateUser('nonexistent');
      expect(result).toBeNull();
    });
  });
});
