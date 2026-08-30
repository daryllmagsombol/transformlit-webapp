/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { MicrosoftStrategy } from './microsoft.strategy';
import { AuthService } from '../auth.service';

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
});