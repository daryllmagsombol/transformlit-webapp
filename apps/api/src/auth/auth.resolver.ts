import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { AuthService } from './auth.service.js';
import { AuthPayload, RegisterLocalInput, LoginLocalInput } from './models/auth.model.js';

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
}
