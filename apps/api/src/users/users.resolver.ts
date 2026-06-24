import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UpdateProfileInput } from './models/user.model.js';
import { User } from '../auth/models/auth.model.js';

@Resolver()
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => User, { name: 'me' })
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: { id: string }) {
    return this.usersService.findById(user.id);
  }

  @Query(() => [User], { name: 'users' })
  @UseGuards(JwtAuthGuard)
  async users() {
    return this.usersService.listUsers();
  }

  @Query(() => [User], { name: 'searchUsers' })
  @UseGuards(JwtAuthGuard)
  async searchUsers(@Args('query') query: string) {
    return this.usersService.searchUsers(query);
  }

  @Mutation(() => User, { name: 'updateProfile' })
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() user: { id: string },
    @Args('input') input: UpdateProfileInput,
  ) {
    return this.usersService.updateProfile(user.id, input);
  }
}
