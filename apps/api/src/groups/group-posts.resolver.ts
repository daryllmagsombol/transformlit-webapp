import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { GroupPostsService } from './group-posts.service.js';
import {
  GroupPost,
  GroupPostComment,
  CreateGroupPostInput,
} from './models/group-post.model.js';

@Resolver()
export class GroupPostsResolver {
  constructor(private readonly groupPostsService: GroupPostsService) {}

  @Query(() => [GroupPost], { name: 'groupPosts' })
  @UseGuards(JwtAuthGuard)
  async groupPosts(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ) {
    return this.groupPostsService.listPosts(groupId, user.id, offset, limit);
  }

  @Query(() => [GroupPostComment], { name: 'groupPostComments' })
  @UseGuards(JwtAuthGuard)
  async groupPostComments(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
  ) {
    return this.groupPostsService.listComments(postId, user.id);
  }

  @Mutation(() => GroupPost, { name: 'createGroupPost' })
  @UseGuards(JwtAuthGuard)
  async createGroupPost(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('input') input: CreateGroupPostInput,
  ) {
    return this.groupPostsService.createPost(groupId, user.id, input);
  }

  @Mutation(() => Boolean, { name: 'deleteGroupPost' })
  @UseGuards(JwtAuthGuard)
  async deleteGroupPost(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
  ) {
    return this.groupPostsService.deletePost(postId, user.id);
  }

  @Mutation(() => Boolean, { name: 'toggleGroupPostLike' })
  @UseGuards(JwtAuthGuard)
  async toggleGroupPostLike(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
  ) {
    return this.groupPostsService.toggleLike(postId, user.id);
  }

  @Mutation(() => GroupPostComment, { name: 'createGroupPostComment' })
  @UseGuards(JwtAuthGuard)
  async createGroupPostComment(
    @CurrentUser() user: { id: string },
    @Args('postId') postId: string,
    @Args('body') body: string,
  ) {
    return this.groupPostsService.createComment(postId, user.id, body);
  }

  @Mutation(() => Boolean, { name: 'deleteGroupPostComment' })
  @UseGuards(JwtAuthGuard)
  async deleteGroupPostComment(
    @CurrentUser() user: { id: string },
    @Args('commentId') commentId: string,
  ) {
    return this.groupPostsService.deleteComment(commentId, user.id);
  }
}