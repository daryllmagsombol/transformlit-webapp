import { Resolver, Mutation, Args, Query } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RegisterLocalInput, LoginLocalInput } from '@transformlit/shared';
import { AuthPayload, User } from './models/auth.model.js';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayload, { name: 'registerLocal' })
  async registerLocal(@Args('input') input: RegisterLocalInput) {
    return this.authService.registerLocal(input);
  }

  @Mutation(() => AuthPayload, { name: 'loginLocal' })
  async loginLocal(@Args('input') input: LoginLocalInput) {
    return this.authService.loginLocal(input);
  }

  @Mutation(() => AuthPayload, { name: 'refreshToken' })
  async refreshToken(@Args('refreshToken') refreshToken: string) {
    return this.authService.refreshTokens(refreshToken);
  }

  @Query(() => User, { name: 'me' })
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: { id: string }) {
    return this.authService.validateUser(user.id);
  }
}
