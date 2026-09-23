import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from '../auth.service.js';
import { OAUTH_STATE_COOKIE_NAME } from '../auth.controller.js';

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
      // Read the incoming request so validate() can enforce the OAuth state
      // cookie against the state echoed by the provider. The state value itself
      // is injected as a *string* authenticate option on the start route (via
      // OAuthStartGuard) so passport appends it to the authorize URL without
      // needing its session-based state store.
      passReqToCallback: true,
    });

    if (!clientID) {
      Logger.warn('Google OAuth disabled — set GOOGLE_CLIENT_ID to enable SSO', GoogleStrategy.name);
    }
  }

  async validate(
    req: Request,
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ) {
    this.assertValidState(req);

    const { id, displayName, emails } = profile;
    const email = emails?.[0]?.value;
    if (!email) throw new UnauthorizedException('No email in Google profile');

    const emailVerified =
      emails?.[0]?.verified ?? profile._json?.email_verified ?? false;

    const tokens = await this.authService.findOrCreateOAuthUser({
      provider: 'google',
      providerId: id,
      email,
      emailVerified,
      displayName,
    });

    done(null, tokens);
  }

  /** CSRF protection: the state echoed by Google must match the cookie we set on the /auth/google start route. */
  private assertValidState(req: Request) {
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    const cookieState = cookies[OAUTH_STATE_COOKIE_NAME];
    const queryState =
      typeof req.query?.state === 'string' ? req.query.state : undefined;
    if (!cookieState || !queryState || cookieState !== queryState) {
      throw new UnauthorizedException('Invalid OAuth state');
    }
  }
}
