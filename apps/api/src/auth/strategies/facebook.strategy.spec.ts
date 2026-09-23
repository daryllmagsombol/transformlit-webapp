/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { FacebookStrategy } from './facebook.strategy';
import { AuthService } from '../auth.service';
import { OAUTH_STATE_COOKIE_NAME } from '../auth.controller';

describe('FacebookStrategy', () => {
  const mockAuthService = {
    findOrCreateOAuthUser: jest.fn(),
  } as unknown as AuthService;

  it('constructs without throwing when env vars are absent (placeholder path)', () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const strategy = new FacebookStrategy(mockConfigService, mockAuthService);

    expect((strategy as any)._oauth2._clientId).toBe('placeholder');
  });

  it('passes the correct options when env vars are present', () => {
    const mockConfigService = {
      get: jest.fn((key: string) =>
        key === 'FACEBOOK_CLIENT_ID' ? 'facebook-client-id' : 'facebook-client-secret',
      ),
    } as unknown as ConfigService;

    const strategy = new FacebookStrategy(mockConfigService, mockAuthService);

    expect((strategy as any)._oauth2._clientId).toBe('facebook-client-id');
    expect((strategy as any)._oauth2._clientSecret).toBe('facebook-client-secret');
    expect((strategy as any)._callbackURL).toBe('/auth/facebook/callback');
    expect((strategy as any)._scope).toEqual(['public_profile', 'email']);
    expect((strategy as any)._profileFields).toEqual([
      'id',
      'displayName',
      'photos',
      'email',
    ]);
    expect((strategy as any)._oauth2._authorizeUrl).toContain('/v26.0/dialog/oauth');
  });

  describe('validate', () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    let strategy: FacebookStrategy;

    beforeEach(() => {
      jest.clearAllMocks();
      strategy = new FacebookStrategy(mockConfigService, mockAuthService);
    });

    const makeReq = (state?: string) =>
      ({
        cookies: state ? { [OAUTH_STATE_COOKIE_NAME]: state } : {},
        query: state ? { state } : {},
      }) as any;

    it('throws when the profile has no email', async () => {
      await expect(
        (strategy as any).validate(makeReq('valid-state'), 'token', 'refresh', { id: 'fb-1', emails: [] }, jest.fn()),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });

    it('treats a returned Facebook email as verified and passes it through', async () => {
      const done = jest.fn();
      const tokens = { accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1' } };
      (mockAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue(tokens);

      await (strategy as any).validate(
        makeReq('valid-state'),
        'token',
        'refresh',
        {
          id: 'fb-1',
          displayName: 'FB User',
          emails: [{ value: 'fb@example.com' }],
          _json: { id: 'fb-1', email: 'fb@example.com' },
        },
        done,
      );

      expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith({
        provider: 'facebook',
        providerId: 'fb-1',
        email: 'fb@example.com',
        emailVerified: true,
        displayName: 'FB User',
      });
      expect(done).toHaveBeenCalledWith(null, tokens);
    });

    it('falls back to profile._json.email when emails is empty', async () => {
      const done = jest.fn();
      (mockAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue({});

      await (strategy as any).validate(
        makeReq('valid-state'),
        'token',
        'refresh',
        { id: 'fb-1', displayName: 'FB User', emails: [], _json: { email: 'fb2@example.com' } },
        done,
      );

      expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith({
        provider: 'facebook',
        providerId: 'fb-1',
        email: 'fb2@example.com',
        emailVerified: true,
        displayName: 'FB User',
      });
    });

    it('throws when the state cookie is missing', async () => {
      await expect(
        (strategy as any).validate(
          makeReq(undefined),
          'token',
          'refresh',
          { id: 'fb-1', emails: [{ value: 'fb@example.com' }] },
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
          { id: 'fb-1', emails: [{ value: 'fb@example.com' }] },
          jest.fn(),
        ),
      ).rejects.toThrow('Invalid OAuth state');
      expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });
  });
});