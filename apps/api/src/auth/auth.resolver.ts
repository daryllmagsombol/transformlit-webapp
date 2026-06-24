import { Resolver, Mutation, Args, Query } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  RegisterLocalInput,
  LoginLocalInput,
  RefreshTokenInput,
} from '@transformlit/shared';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => String, { name: 'registerLocal' })
  async registerLocal(@Args('input') input: RegisterLocalInput) {
    return this.authService.registerLocal(input);
  }

  @Mutation(() => String, { name: 'loginLocal' })
  async loginLocal(@Args('input') input: LoginLocalInput) {
    return this.authService.loginLocal(input);
  }

  @Mutation(() => String, { name: 'refreshToken' })
  async refreshToken(@Args('input') input: RefreshTokenInput) {
    return this.authService.refreshTokens(input.refreshToken);
  }

  @Query(() => String, { name: 'me' })
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: { id: string }) {
    return this.authService.validateUser(user.id);
  }
}
