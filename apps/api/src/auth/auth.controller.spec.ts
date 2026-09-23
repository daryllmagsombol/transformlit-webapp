/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AuthController, REFRESH_COOKIE_NAME } from './auth.controller';
import { AuthService } from './auth.service';
import type { Request, Response } from 'express';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'MEMBER',
  status: 'ACTIVE',
  createdAt: new Date('2024-01-01'),
};

const mockTokens = {
  accessToken: 'access-token-1',
  refreshToken: 'raw-refresh-token-1',
  user: mockUser,
};

describe('AuthController (REST httpOnly cookie flows)', () => {
  let controller: AuthController;
  let authService: { [k: string]: jest.Mock };

  // A minimal Express Response stub that records cookie/clearCookie calls.
  const createRes = () => {
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response & { cookie: jest.Mock; clearCookie: jest.Mock; redirect: jest.Mock };
    return res;
  };

  beforeEach(async () => {
    authService = {
      loginLocal: jest.fn().mockResolvedValue(mockTokens),
      registerLocal: jest.fn().mockResolvedValue(mockTokens),
      refreshTokens: jest.fn().mockResolvedValue(mockTokens),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
    authService.loginLocal.mockResolvedValue(mockTokens);
    authService.registerLocal.mockResolvedValue(mockTokens);
    authService.refreshTokens.mockResolvedValue(mockTokens);
  });

  describe('POST /auth/login', () => {
    it('sets the refresh httpOnly cookie and returns { accessToken, user } with NO refreshToken', async () => {
      const res = createRes();
      const body = { email: 'test@example.com', password: 'password123' };

      const result = await controller.login(body, res);

      expect(authService.loginLocal).toHaveBeenCalledWith(body);
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'raw-refresh-token-1',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60 * 1000,
          secure: process.env.NODE_ENV !== 'development',
        }),
      );
      expect(result).toEqual({ accessToken: 'access-token-1', user: mockUser });
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('rejects a body missing email/password', async () => {
      await expect(controller.login({ email: '', password: 'x' }, createRes())).rejects.toThrow(
        BadRequestException,
      );
      expect(authService.loginLocal).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/register', () => {
    it('sets the refresh httpOnly cookie and returns { accessToken, user } with NO refreshToken', async () => {
      const res = createRes();
      const body = {
        email: 'new@example.com',
        password: 'password123',
        displayName: 'New',
      };

      const result = await controller.register(body, res);

      expect(authService.registerLocal).toHaveBeenCalledWith(body);
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'raw-refresh-token-1',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
      expect(result).toEqual({ accessToken: 'access-token-1', user: mockUser });
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('rejects a body missing displayName', async () => {
      await expect(
        controller.register({ email: 'a@b.com', password: 'password123', displayName: '' }, createRes()),
      ).rejects.toThrow(BadRequestException);
      expect(authService.registerLocal).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the token from the cookie and sets a fresh cookie', async () => {
      const res = createRes();
      const req = {
        cookies: { [REFRESH_COOKIE_NAME]: 'raw-refresh-token-1' },
      } as unknown as Request;

      const result = await controller.refresh(req, res);

      expect(authService.refreshTokens).toHaveBeenCalledWith('raw-refresh-token-1');
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'raw-refresh-token-1',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
      expect(result).toEqual({ accessToken: 'access-token-1', user: mockUser });
    });

    it('returns 401 when no refresh cookie is present', async () => {
      const req = { cookies: {} } as unknown as Request;
      await expect(controller.refresh(req, createRes())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.refreshTokens).not.toHaveBeenCalled();
    });

    it('maps an authService refresh failure to 401 Invalid refresh token', async () => {
      authService.refreshTokens.mockRejectedValue(new UnauthorizedException());
      const req = {
        cookies: { [REFRESH_COOKIE_NAME]: 'bad-token' },
      } as unknown as Request;
      await expect(controller.refresh(req, createRes())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the refresh cookie (maxAge 0) and returns {}', async () => {
      const res = createRes();
      const result = await controller.logout(res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 0,
        }),
      );
      expect(result).toEqual({});
    });
  });
});
