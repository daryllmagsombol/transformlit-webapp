import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID') ?? '';
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET') ?? '';

    // Passport's OAuth2Strategy requires truthy clientID at construction
    // time. Provide a placeholder when the env var is missing so the app
    // boots cleanly in local dev / CI without the secret.
    super({
      clientID: clientID || 'placeholder',
      clientSecret: clientSecret || 'placeholder',
      callbackURL: '/auth/google/callback',
      scope: ['email', 'profile'],
    });

    if (!clientID) {
      Logger.warn('Google OAuth disabled — set GOOGLE_CLIENT_ID to enable SSO', GoogleStrategy.name);
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ) {
    const { id, displayName, emails } = profile;
    const email = emails?.[0]?.value;
    if (!email) throw new UnauthorizedException('No email in Google profile');

    const tokens = await this.authService.findOrCreateOAuthUser({
      provider: 'google',
      providerId: id,
      email,
      displayName,
    });

    done(null, tokens);
  }
}
