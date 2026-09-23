/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleStrategy } from './google.strategy';
import { AuthService } from '../auth.service';
import { OAUTH_STATE_COOKIE_NAME } from '../auth.controller';

describe('GoogleStrategy', () => {
  const mockAuthService = {
    findOrCreateOAuthUser: jest.fn(),
  } as unknown as AuthService;

  const mockConfigService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  let strategy: GoogleStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new GoogleStrategy(mockConfigService, mockAuthService);
  });

  const makeReq = (state?: string) =>
    ({
      cookies: state ? { [OAUTH_STATE_COOKIE_NAME]: state } : {},
      query: state ? { state } : {},
    }) as any;

  it('constructs without throwing when env vars are absent (placeholder path)', () => {
    expect((strategy as any)._oauth2._clientId).toBe('placeholder');
  });

  it('passes the correct options when env vars are present', () => {
    const mockConfig = {
      get: jest.fn((key: string) =>
        key === 'GOOGLE_CLIENT_ID' ? 'google-client-id' : 'google-client-secret',
      ),
    } as unknown as ConfigService;

    const s = new GoogleStrategy(mockConfig, mockAuthService);

    expect((s as any)._oauth2._clientId).toBe('google-client-id');
    expect((s as any)._oauth2._clientSecret).toBe('google-client-secret');
    expect((s as any)._callbackURL).toBe('/auth/google/callback');
    expect((s as any)._scope).toEqual(['email', 'profile']);
  });

  it('throws when the profile has no email', async () => {
    await expect(
      (strategy as any).validate(makeReq('valid-state'), 'token', 'refresh', { id: 'g-1', emails: [] }, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
  });

  it('passes a verified email flag from profile.emails[0].verified', async () => {
    const done = jest.fn();
    const tokens = { accessToken: 'at', refreshToken: 'rt', user: { id: 'u-1' } };
    (mockAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue(tokens);

    await (strategy as any).validate(
      makeReq('valid-state'),
      'token',
      'refresh',
      {
        id: 'g-1',
        displayName: 'Google User',
        emails: [{ value: 'google@example.com', verified: true }],
        _json: { email_verified: true },
      },
      done,
    );

    expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith({
      provider: 'google',
      providerId: 'g-1',
      email: 'google@example.com',
      emailVerified: true,
      displayName: 'Google User',
    });
    expect(done).toHaveBeenCalledWith(null, tokens);
  });

  it('falls back to _json.email_verified when emails[0].verified is absent', async () => {
    const done = jest.fn();
    (mockAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue({});

    await (strategy as any).validate(
      makeReq('valid-state'),
      'token',
      'refresh',
      {
        id: 'g-1',
        displayName: 'Google User',
        emails: [{ value: 'google@example.com' }],
        _json: { email_verified: true },
      },
      done,
    );

    expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: true }),
    );
  });

  it('defaults emailVerified to false for unverified Google emails', async () => {
    const done = jest.fn();
    (mockAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue({});

    await (strategy as any).validate(
      makeReq('valid-state'),
      'token',
      'refresh',
      {
        id: 'g-1',
        displayName: 'Google User',
        emails: [{ value: 'google@example.com', verified: false }],
        _json: { email_verified: false },
      },
      done,
    );

    expect(mockAuthService.findOrCreateOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: false }),
    );
  });

  describe('OAuth state verification', () => {
    it('throws when the state cookie is missing', async () => {
      const done = jest.fn();
      await expect(
        (strategy as any).validate(
          makeReq(undefined),
          'token',
          'refresh',
          { id: 'g-1', emails: [{ value: 'g@example.com' }] },
          done,
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
          { id: 'g-1', emails: [{ value: 'g@example.com' }] },
          jest.fn(),
        ),
      ).rejects.toThrow('Invalid OAuth state');
      expect(mockAuthService.findOrCreateOAuthUser).not.toHaveBeenCalled();
    });
  });
});
