import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthResolver } from './auth.resolver.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { GoogleStrategy } from './strategies/google.strategy.js';
import { FacebookStrategy } from './strategies/facebook.strategy.js';
import { MicrosoftStrategy } from './strategies/microsoft.strategy.js';
import {
  GoogleOAuthStartGuard,
  FacebookOAuthStartGuard,
  MicrosoftOAuthStartGuard,
} from './oauth-start.guard.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthResolver,
    JwtAuthGuard,
    RolesGuard,
    JwtStrategy,
    GoogleStrategy,
    FacebookStrategy,
    MicrosoftStrategy,
    GoogleOAuthStartGuard,
    FacebookOAuthStartGuard,
    MicrosoftOAuthStartGuard,
  ],
  exports: [JwtAuthGuard, RolesGuard, AuthService, JwtModule],
})
export class AuthModule {}
