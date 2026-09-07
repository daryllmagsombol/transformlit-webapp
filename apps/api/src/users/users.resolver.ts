import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UpdateProfileInput } from './models/user.model.js';
import { UserProfile } from './models/user-profile.model.js';
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
  async users(@CurrentUser() user: { id: string }) {
    return this.usersService.listUsers(user.id);
  }

  @Query(() => [User], { name: 'searchUsers' })
  @UseGuards(JwtAuthGuard)
  async searchUsers(
    @CurrentUser() user: { id: string },
    @Args('query') query: string,
  ) {
    return this.usersService.searchUsers(query, user.id);
  }

  @Query(() => UserProfile, { name: 'userProfile' })
  @UseGuards(JwtAuthGuard)
  async userProfile(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
  ) {
    return this.usersService.getProfile(id, user.id);
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
