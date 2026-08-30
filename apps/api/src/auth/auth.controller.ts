import { Controller, Get, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { Public } from '../common/decorators/public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(@Req() req: any, @Res() res: any) {
    this.redirectWithTokens(res, req.user);
  }

  @Public()
  @Get('facebook')
  @UseGuards(AuthGuard('facebook'))
  facebookAuth() {}

  @Public()
  @Get('facebook/callback')
  @UseGuards(AuthGuard('facebook'))
  async facebookAuthCallback(@Req() req: any, @Res() res: any) {
    this.redirectWithTokens(res, req.user);
  }

  @Public()
  @Get('microsoft')
  @UseGuards(AuthGuard('microsoft'))
  microsoftAuth() {}

  @Public()
  @Get('microsoft/callback')
  @UseGuards(AuthGuard('microsoft'))
  async microsoftAuthCallback(@Req() req: any, @Res() res: any) {
    this.redirectWithTokens(res, req.user);
  }

  // Redirect to frontend with tokens
  private redirectWithTokens(res: any, tokens: any) {
    res.redirect(
      `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/login?token=${tokens.accessToken}&refresh=${tokens.refreshToken}`,
    );
  }
}
