import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service.js';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientID = config.get<string>('FACEBOOK_CLIENT_ID') ?? '';
    const clientSecret = config.get<string>('FACEBOOK_CLIENT_SECRET') ?? '';

    // Passport's OAuth2Strategy requires truthy clientID at construction
    // time. Provide a placeholder when the env var is missing so the app
    // boots cleanly in local dev / CI without the secret.
    super({
      clientID: clientID || 'placeholder',
      clientSecret: clientSecret || 'placeholder',
      callbackURL: '/auth/facebook/callback',
      // passport-facebook defaults to the long-expired v3.2; pin a current
      // Graph API version or the dialog rejects valid scopes ("Invalid Scopes").
      graphAPIVersion: 'v26.0',
      profileFields: ['id', 'displayName', 'photos', 'email'],
      scope: ['public_profile', 'email'],
    });

    if (!clientID) {
      Logger.warn('Facebook OAuth disabled — set FACEBOOK_CLIENT_ID to enable SSO', FacebookStrategy.name);
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (error: any, user?: any, info?: any) => void,
  ) {
    const { id, displayName, emails } = profile;
    const email = emails?.[0]?.value;
    if (!email) throw new UnauthorizedException('No email in Facebook profile');

    const tokens = await this.authService.findOrCreateOAuthUser({
      provider: 'facebook',
      providerId: id,
      email,
      displayName,
    });

    done(null, tokens);
  }
}