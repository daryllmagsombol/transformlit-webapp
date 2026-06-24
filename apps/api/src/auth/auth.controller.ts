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
    const tokens = req.user;
    // Redirect to frontend with tokens
    res.redirect(
      `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/login?token=${tokens.accessToken}&refresh=${tokens.refreshToken}`,
    );
  }
}
