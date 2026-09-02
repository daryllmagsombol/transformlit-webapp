/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { FacebookStrategy } from './facebook.strategy';
import { AuthService } from '../auth.service';

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
});