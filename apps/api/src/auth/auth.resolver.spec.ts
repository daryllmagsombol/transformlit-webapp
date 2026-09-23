/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';

jest.mock('./models/auth.model', () => ({
  AuthPayload: class {},
  RegisterLocalInput: class {},
  LoginLocalInput: class {},
}));

const mockAuthPayload = {
  accessToken: 'access-token',
  user: {
    id: 'user-1',
    email: 'test@example.com',
    displayName: 'Test User',
    role: 'MEMBER',
    status: 'ACTIVE',
    createdAt: new Date('2024-01-01'),
  },
};

describe('AuthResolver', () => {
  let resolver: AuthResolver;
  let service: AuthService;

  beforeEach(async () => {
    const mockAuthService = {
      registerLocal: jest.fn().mockResolvedValue(mockAuthPayload),
      loginLocal: jest.fn().mockResolvedValue(mockAuthPayload),
      refreshTokens: jest.fn().mockResolvedValue(mockAuthPayload),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthResolver,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    resolver = module.get<AuthResolver>(AuthResolver);
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('registerLocal', () => {
    const input = { email: 'test@example.com', password: 'password123', displayName: 'Test' };

    it('should delegate to authService.registerLocal', async () => {
      const result = await resolver.registerLocal(input);
      expect(service.registerLocal).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockAuthPayload);
    });

    it('should return AuthPayload with accessToken and user (no refreshToken)', async () => {
      const result = await resolver.registerLocal(input);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('user');
      expect(result).not.toHaveProperty('refreshToken');
    });
  });

  describe('loginLocal', () => {
    const input = { email: 'test@example.com', password: 'password123' };

    it('should delegate to authService.loginLocal', async () => {
      const result = await resolver.loginLocal(input);
      expect(service.loginLocal).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockAuthPayload);
    });

    it('should return AuthPayload without a refreshToken field', async () => {
      const result = await resolver.loginLocal(input);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('user');
      expect(result).not.toHaveProperty('refreshToken');
    });
  });

  describe('refreshToken', () => {
    it('should be removed from the resolver surface (httpOnly-refresh migration)', async () => {
      expect((resolver as any).refreshToken).toBeUndefined();
    });
  });
});