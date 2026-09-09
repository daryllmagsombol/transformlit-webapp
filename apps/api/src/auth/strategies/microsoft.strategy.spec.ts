/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { MicrosoftStrategy } from './microsoft.strategy';
import { AuthService } from '../auth.service';
import { OAUTH_STATE_COOKIE_NAME } from '../auth.controller';

describe('MicrosoftStrategy', () => {
  const mockAuthService = {
    findOrCreateOAuthUser: jest.fn(),
  } as unknown as AuthService;

  it('constructs without throwing when env vars are absent (placeholder path)', () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const strategy = new MicrosoftStrategy(mockConfigService, mockAuthService);

    expect((strategy as any)._oauth2._clientId).toBe('placeholder');
  });

  it('passes the correct options when env vars are present', () => {
    const mockConfigService = {
      get: jest.fn((key: string) =>
        key === 'MICROSOFT_CLIENT_ID' ? 'microsoft-client-id' : 'microsoft-client-secret',
      ),
    } as unknown as ConfigService;

    const strategy = new MicrosoftStrategy(mockConfigService, mockAuthService);

    expect((strategy as any)._oauth2._clientId).toBe('microsoft-client-id');
    expect((strategy as any)._oauth2._clientSecret).toBe('microsoft-client-secret');
    expect((strategy as any)._callbackURL).toBe('/auth/microsoft/callback');
    expect((strategy as any)._scope).toEqual(['user.read']);
    // tenant: 'common' → Microsoft v2.0 authorize endpoint
    expect((strategy as any)._oauth2._authorizeUrl).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
  });

  describe('validate', () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    let strategy: MicrosoftStrategy;

    beforeEach(() => {
      jest.clearAllMocks();
      strategy = new MicrosoftStrategy(mockConfigService, mockAuthService);
    });

    const makeReq = (state?: string) =>
      ({
        cookies: state ? { [OAUTH_STATE_COOKIE_NAME]: state } : {},
        query: state ? { state } : {},
      }) as any;

    it('throws when the profile has no email', async () => {
      await expect(
        (strategy as any).validate(makeReq('valid-state'), 'token', 'refresh', { id: 'ms-1', emails: [] }, jest.fn()),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });

    it('passes the email and treats it as verified', async () => {
      const done = jest.fn();
      const tokens = { accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1' } };
      (mockAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue(tokens);

      await (strategy as any).validate(
        makeReq('valid-state'),
        'token',
        'refresh',
        {
          id: 'ms-1',
          displayName: 'MS User',
          emails: [{ type: 'work', value: 'ms@example.com' }],
          _json: { mail: 'ms@example.com', displayName: 'MS User' },
        },
        done,
      );

      expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith({
        provider: 'microsoft',
        providerId: 'ms-1',
        email: 'ms@example.com',
        emailVerified: true,
        displayName: 'MS User',
      });
      expect(done).toHaveBeenCalledWith(null, tokens);
    });

    it('falls back to _json.mail / userPrincipalName when emails is absent', async () => {
      const done = jest.fn();
      (mockAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue({});

      await (strategy as any).validate(
        makeReq('valid-state'),
        'token',
        'refresh',
        { id: 'ms-2', _json: { mail: 'upn@example.com' } },
        done,
      );

      expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith({
        provider: 'microsoft',
        providerId: 'ms-2',
        email: 'upn@example.com',
        emailVerified: true,
        displayName: undefined,
      });
    });

    it('throws when the state cookie is missing', async () => {
      await expect(
        (strategy as any).validate(
          makeReq(undefined),
          'token',
          'refresh',
          { id: 'ms-1', emails: [{ value: 'ms@example.com' }] },
          jest.fn(),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });

    it('throws when the provider state does not match the cookie (CSRF)', async () => {
      const req = makeReq('cookie-state');
      req.query = { state: 'attacker-state' };
      await expect(
        (strategy as any).validate(
          req,
          'token',
          'refresh',
          { id: 'ms-1', emails: [{ value: 'ms@example.com' }] },
          jest.fn(),
        ),
      ).rejects.toThrow('Invalid OAuth state');
      expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });
  });
});