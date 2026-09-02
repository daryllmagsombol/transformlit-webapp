import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service.js';

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientID = config.get<string>('MICROSOFT_CLIENT_ID') ?? '';
    const clientSecret = config.get<string>('MICROSOFT_CLIENT_SECRET') ?? '';

    // Passport's OAuth2Strategy requires truthy clientID at construction
    // time. Provide a placeholder when the env var is missing so the app
    // boots cleanly in local dev / CI without the secret.
    super({
      clientID: clientID || 'placeholder',
      clientSecret: clientSecret || 'placeholder',
      callbackURL: '/auth/microsoft/callback',
      tenant: 'common',
      scope: ['user.read'],
    });

    if (!clientID) {
      Logger.warn('Microsoft OAuth disabled — set MICROSOFT_CLIENT_ID to enable SSO', MicrosoftStrategy.name);
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (error: any, user?: any, info?: any) => void,
  ) {
    const providerId = profile.id;
    const email =
      profile.emails?.[0]?.value ??
      profile._json?.mail ??
      profile._json?.userPrincipalName;
    if (!email) throw new UnauthorizedException('No email in Microsoft profile');

    const displayName = profile.displayName ?? profile._json?.displayName;

    const tokens = await this.authService.findOrCreateOAuthUser({
      provider: 'microsoft',
      providerId,
      email,
      displayName,
    });

    done(null, tokens);
  }
}