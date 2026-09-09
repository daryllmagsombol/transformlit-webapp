import { Controller, Get, Post, HttpCode, Body, Req, Res, UseGuards, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  GoogleOAuthStartGuard,
  FacebookOAuthStartGuard,
  MicrosoftOAuthStartGuard,
} from './oauth-start.guard.js';

// Cookie + OAuth state constants. The raw refresh token only ever lives in the
// httpOnly cookie — it never reaches JS (not in a body, URL, or localStorage).
export const REFRESH_COOKIE_NAME = 'transformlit_refresh';
export const OAUTH_STATE_COOKIE_NAME = 'transformlit_oauth_state';
export const OAUTH_STATE_COOKIE_MAX_AGE = 10 * 60 * 1000; // 10 minutes
export const OAUTH_ERROR_PARAM = 'error=oauth_failed';

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    status: string;
    lastLoginAt?: Date | null;
    createdAt: Date;
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Credential endpoints (plain POST handlers — no JWT guard) ─────────────

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const tokens = await this.authService.loginLocal({ email, password });
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user } as AuthResponse;
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    if (!email || !password || !displayName) {
      throw new BadRequestException('Email, password, and displayName are required');
    }

    const tokens = await this.authService.registerLocal({ email, password, displayName });
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user } as AuthResponse;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!raw) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    try {
      const tokens = await this.authService.refreshTokens(raw);
      this.setRefreshCookie(res, tokens.refreshToken);
      return { accessToken: tokens.accessToken, user: tokens.user } as AuthResponse;
    } catch {
      // Reuse/invalid/expired token — surface a clean 401. The refresh cookie is
      // left for the caller to clear via /auth/logout if they choose.
      // Exception is re-thrown as UnauthorizedException
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.clearRefreshCookie(res);
    return {};
  }

  // ── OAuth endpoints ────────────────────────────────────────────────────────

  @Public()
  @Get('google')
  @UseGuards(GoogleOAuthStartGuard)
  googleAuth(): void {
    // OAuth flow is handled by the guard; this method intentionally left empty
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(@Req() req: any, @Res() res: Response) {
    this.finishOAuthCallback(req, res);
  }

  @Public()
  @Get('facebook')
  @UseGuards(FacebookOAuthStartGuard)
  facebookAuth(): void {
    // OAuth flow is handled by the guard; this method intentionally left empty
  }

  @Public()
  @Get('facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  async facebookAuthCallback(@Req() req: any, @Res() res: Response) {
    this.finishOAuthCallback(req, res);
  }

  @Public()
  @Get('microsoft')
  @UseGuards(MicrosoftOAuthStartGuard)
  microsoftAuth(): void {
    // OAuth flow is handled by the guard; this method intentionally left empty
  }

  @Public()
  @Get('microsoft/callback')
  @UseGuards(AuthGuard('microsoft'))
  async microsoftAuthCallback(@Req() req: any, @Res() res: Response) {
    this.finishOAuthCallback(req, res);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private cookieBase() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV !== 'development',
    };
  }

  private setRefreshCookie(res: Response, rawRefreshToken: string) {
    res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, {
      ...this.cookieBase(),
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...this.cookieBase(),
      maxAge: 0,
    });
  }

  /**
   * Resolve the frontend origin to redirect OAuth callbacks to, enforcing a
   * strict allow-list. NEVER echo an attacker-controlled redirect param — the
   * target is derived only from environment configuration.
   *
   * Allow-list = 'http://localhost:3000' (always, for local dev) ∪
   * FRONTEND_URL_DEV ∪ FRONTEND_URL_PROD ∪ FRONTEND_URL (single deploy target).
   */
  private safeFrontend(): string {
    const allowed = new Set<string>(['http://localhost:3000']);
    for (const key of ['FRONTEND_URL_DEV', 'FRONTEND_URL_PROD', 'FRONTEND_URL'] as const) {
      const value = process.env[key]?.trim();
      if (value) allowed.add(value);
    }

    const frontend =
      process.env.FRONTEND_URL?.trim() ??
      (process.env.NODE_ENV === 'production'
        ? process.env.FRONTEND_URL_PROD?.trim()
        : process.env.FRONTEND_URL_DEV?.trim()) ??
      'http://localhost:3000';

    if (!allowed.has(frontend)) {
      // Misdirected deployment — refuse rather than redirect to an unknown host.
      throw new Error('FRONTEND_URL is not in the allowed redirect list');
    }
    return frontend.replace(/\/+$/, '');
  }

  private clearOAuthStateCookie(res: Response) {
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV !== 'development',
      maxAge: 0,
    });
  }

  private finishOAuthCallback(req: any, res: Response) {
    // State is verified inside each strategy's validate() BEFORE any account is
    // created/linked, so by the time we get here the login already succeeded.
    const tokens = req.user;
    if (!tokens?.accessToken || !tokens?.refreshToken) {
      this.clearOAuthStateCookie(res);
      return res.redirect(`${this.safeFrontend()}/login?${OAUTH_ERROR_PARAM}`);
    }

    this.setRefreshCookie(res, tokens.refreshToken);
    this.clearOAuthStateCookie(res);
    return res.redirect(`${this.safeFrontend()}/login`);
  }
}
