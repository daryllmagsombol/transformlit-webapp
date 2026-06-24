import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Friendship } from './models/friend.model.js';

@Resolver()
export class FriendsResolver {
  constructor(private readonly friendsService: FriendsService) {}

  @Query(() => [Friendship], { name: 'friends' })
  @UseGuards(JwtAuthGuard)
  async friends(@CurrentUser() user: { id: string }) {
    return this.friendsService.listFriends(user.id);
  }

  @Query(() => [Friendship], { name: 'friendRequests' })
  @UseGuards(JwtAuthGuard)
  async friendRequests(@CurrentUser() user: { id: string }) {
    return this.friendsService.listRequests(user.id);
  }

  @Mutation(() => Friendship, { name: 'sendFriendRequest' })
  @UseGuards(JwtAuthGuard)
  async sendFriendRequest(
    @CurrentUser() user: { id: string },
    @Args('addresseeId') addresseeId: string,
  ) {
    return this.friendsService.sendRequest(user.id, addresseeId);
  }

  @Mutation(() => Friendship, { name: 'acceptFriendRequest' })
  @UseGuards(JwtAuthGuard)
  async acceptFriendRequest(
    @CurrentUser() user: { id: string },
    @Args('friendshipId') friendshipId: string,
  ) {
    return this.friendsService.acceptRequest(friendshipId, user.id);
  }

  @Mutation(() => Friendship, { name: 'rejectFriendRequest' })
  @UseGuards(JwtAuthGuard)
  async rejectFriendRequest(
    @CurrentUser() user: { id: string },
    @Args('friendshipId') friendshipId: string,
  ) {
    return this.friendsService.rejectRequest(friendshipId, user.id);
  }

  @Mutation(() => Boolean, { name: 'removeFriend' })
  @UseGuards(JwtAuthGuard)
  async removeFriend(@Args('friendshipId') friendshipId: string) {
    return this.friendsService.removeFriend(friendshipId);
  }
}
