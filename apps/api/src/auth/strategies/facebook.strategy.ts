import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from '../auth.service.js';
import { OAUTH_STATE_COOKIE_NAME } from '../auth.controller.js';

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
      // Read the incoming request so validate() can enforce the OAuth state
      // cookie against the state echoed by the provider. The state value itself
      // is injected as a *string* authenticate option on the start route (via
      // OAuthStartGuard) so passport appends it to the authorize URL without
      // needing its session-based state store.
      passReqToCallback: true,
    });

    if (!clientID) {
      Logger.warn('Facebook OAuth disabled — set FACEBOOK_CLIENT_ID to enable SSO', FacebookStrategy.name);
    }
  }

  async validate(
    req: Request,
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (error: any, user?: any, info?: any) => void,
  ) {
    this.assertValidState(req);

    const { id, displayName, emails } = profile;
    const email = emails?.[0]?.value ?? profile._json?.email;
    if (!email) throw new UnauthorizedException('No email in Facebook profile');

    // Facebook only surfaces an email through the `email` permission, and those
    // addresses are verified by Facebook before they are returned — treat the
    // presence of a provider email as verified. The obsolete Graph `verified`
    // field describes SMS/credit-card account confirmation, NOT email
    // verification, so it must not gate account linking here.
    const emailVerified = Boolean(emails?.[0]?.value ?? profile._json?.email);

    const tokens = await this.authService.findOrCreateOAuthUser({
      provider: 'facebook',
      providerId: id,
      email,
      emailVerified,
      displayName,
    });

    done(null, tokens);
  }

  /** CSRF protection: the state echoed by Facebook must match the cookie we set on the /auth/facebook start route. */
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
