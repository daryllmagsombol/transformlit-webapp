import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { AuthService } from './auth.service.js';
import { AuthPayload, RegisterLocalInput, LoginLocalInput } from './models/auth.model.js';

// NOTE (httpOnly-refresh migration): the `refreshToken` mutation was removed —
// refresh tokens are now handled exclusively by the REST endpoints via an
// httpOnly cookie (POST /auth/refresh). The mutations below are kept for back
// compatibility, but they cannot issue the refresh cookie; use the REST
// endpoints for credential sign-in.
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
}
