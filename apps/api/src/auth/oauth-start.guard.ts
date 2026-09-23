import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_COOKIE_MAX_AGE,
} from './auth.controller.js';

/**
 * Guards for the OAuth *start* routes (/auth/google, /auth/facebook,
 * /auth/microsoft).
 *
 * CSRF protection for the OAuth dance is cookie-based:
 *  1. A random state value is generated, stored in an httpOnly, short-lived
 *     `transformlit_oauth_state` cookie (set on the response), and injected as
 *     a *string* `state` authenticate option. passport-oauth2 appends string
 *     state directly to the provider authorize URL (it never touches its
 *     session-based state store), so the provider echoes it back on callback.
 *  2. On the callback route each provider strategy compares the echoed
 *     `req.query.state` against the `transformlit_oauth_state` cookie BEFORE
 *     calling findOrCreateOAuthUser, so no account is created/linked unless the
 *     dance started from a real browser session we issued the cookie to.
 */
function setStateCookieAndReturnOptions(context: ExecutionContext): { state: string } {
  const res = context.switchToHttp().getResponse<Response>();
  const state = randomBytes(24).toString('hex');

  res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE,
  });

  return { state };
}

@Injectable()
export class GoogleOAuthStartGuard extends AuthGuard('google') {
  override getAuthenticateOptions(context: ExecutionContext) {
    return setStateCookieAndReturnOptions(context) as any;
  }
}

@Injectable()
export class FacebookOAuthStartGuard extends AuthGuard('facebook') {
  override getAuthenticateOptions(context: ExecutionContext) {
    return setStateCookieAndReturnOptions(context) as any;
  }
}

@Injectable()
export class MicrosoftOAuthStartGuard extends AuthGuard('microsoft') {
  override getAuthenticateOptions(context: ExecutionContext) {
    return setStateCookieAndReturnOptions(context) as any;
  }
}
