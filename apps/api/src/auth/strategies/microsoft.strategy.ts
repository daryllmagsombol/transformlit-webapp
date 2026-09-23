import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from '../auth.service.js';
import { OAUTH_STATE_COOKIE_NAME } from '../auth.controller.js';

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
      // Read the incoming request so validate() can enforce the OAuth state
      // cookie against the state echoed by the provider. The state value itself
      // is injected as a *string* authenticate option on the start route (via
      // OAuthStartGuard) so passport appends it to the authorize URL without
      // needing its session-based state store.
      passReqToCallback: true,
    });

    if (!clientID) {
      Logger.warn('Microsoft OAuth disabled — set MICROSOFT_CLIENT_ID to enable SSO', MicrosoftStrategy.name);
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

    const providerId = profile.id;
    const email =
      profile.emails?.[0]?.value ??
      profile._json?.mail ??
      profile._json?.userPrincipalName;
    if (!email) throw new UnauthorizedException('No email in Microsoft profile');

    const displayName = profile.displayName ?? profile._json?.displayName;

    // Microsoft Graph does not expose an `email_verified` flag on /me. The
    // primary SMTP address (mail) and UPN it returns are authoritative
    // directory values from the tenant, so treat their presence as verified.
    const emailVerified = Boolean(email);

    const tokens = await this.authService.findOrCreateOAuthUser({
      provider: 'microsoft',
      providerId,
      email,
      emailVerified,
      displayName,
    });

    done(null, tokens);
  }

  /** CSRF protection: the state echoed by Microsoft must match the cookie we set on the /auth/microsoft start route. */
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
