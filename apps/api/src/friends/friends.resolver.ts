import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Friendship } from './models/friend.model.js';
import { User } from '../auth/models/auth.model.js';

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
  async removeFriend(
    @CurrentUser() user: { id: string },
    @Args('friendshipId') friendshipId: string,
  ) {
    return this.friendsService.removeFriend(friendshipId, user.id);
  }

  @Query(() => Friendship, { name: 'friendshipStatus', nullable: true })
  @UseGuards(JwtAuthGuard)
  async friendshipStatus(
    @CurrentUser() user: { id: string },
    @Args('otherUserId') otherUserId: string,
  ) {
    return this.friendsService.checkFriendship(user.id, otherUserId);
  }

  @Query(() => [User], { name: 'suggestedFriends' })
  @UseGuards(JwtAuthGuard)
  async suggestedFriends(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, defaultValue: 5 }) limit: number,
  ) {
    return this.friendsService.suggestedFriends(user.id, limit);
  }
}
