import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GroupsService } from './groups.service.js';
import { CreateGroupPostInput } from './models/group-post.model.js';

const MAX_COMMENT_LENGTH = 2000;

const postInclude = (actorId: string) => ({
  author: { select: { id: true, displayName: true, avatarUrl: true } },
  _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
  likes: { where: { userId: actorId }, select: { id: true } },
} as const);

@Injectable()
export class GroupPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
  ) {}

  private mapPost(p: any, actorId: string) {
    return {
      ...p,
      likeCount: p._count?.likes ?? 0,
      commentCount: p._count?.comments ?? 0,
      likedByMe: (p.likes?.length ?? 0) > 0,
      likes: undefined,
      _count: undefined,
    };
  }

  async listPosts(groupId: string, actorId: string, offset = 0, limit = 20) {
    await this.assertActiveMember(groupId, actorId);
    const posts = await this.prisma.groupPost.findMany({
      where: { groupId, deletedAt: null },
      include: postInclude(actorId),
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: Math.min(limit, 50),
    });
    return posts.map((p) => this.mapPost(p, actorId));
  }

  async createPost(groupId: string, actorId: string, input: CreateGroupPostInput) {
    await this.assertActiveMember(groupId, actorId);
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Post body is required');
    const post = await this.prisma.groupPost.create({
      data: {
        groupId,
        authorId: actorId,
        body,
        imageKey: input.imageKey ?? null,
      },
      include: postInclude(actorId),
    });
    return this.mapPost(post, actorId);
  }

  async deletePost(postId: string, actorId: string) {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    const membership = await this.groups.getMembershipFor(post.groupId, actorId);
    const canModerate =
      membership?.status === 'ACTIVE' &&
      (membership.role === 'OWNER' || membership.role === 'MODERATOR');
    if (post.authorId !== actorId && !canModerate) {
      throw new ForbiddenException('Not allowed to delete this post');
    }
    await this.prisma.groupPost.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  async toggleLike(postId: string, actorId: string): Promise<boolean> {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertActiveMember(post.groupId, actorId);
    const existing = await this.prisma.groupPostLike.findUnique({
      where: { postId_userId: { postId, userId: actorId } },
    });
    if (existing) {
      await this.prisma.groupPostLike.delete({ where: { id: existing.id } });
      return false;
    }
    await this.prisma.groupPostLike.create({
      data: { postId, userId: actorId },
    });
    return true;
  }

  async listComments(postId: string, actorId: string) {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertActiveMember(post.groupId, actorId);
    return this.prisma.groupPostComment.findMany({
      where: { postId, deletedAt: null },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createComment(postId: string, actorId: string, body: string) {
    const post = await this.prisma.groupPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Post not found');
    await this.assertActiveMember(post.groupId, actorId);
    const trimmed = body.trim();
    if (!trimmed) throw new BadRequestException('Comment body is required');
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      throw new BadRequestException('Comment is too long');
    }
    return this.prisma.groupPostComment.create({
      data: { postId, authorId: actorId, body: trimmed },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
  }

  async deleteComment(commentId: string, actorId: string) {
    const comment = await this.prisma.groupPostComment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    const post = await this.prisma.groupPost.findUnique({
      where: { id: comment.postId },
    });
    const membership = await this.groups.getMembershipFor(post!.groupId, actorId);
    const canModerate =
      membership?.status === 'ACTIVE' &&
      (membership.role === 'OWNER' || membership.role === 'MODERATOR');
    if (comment.authorId !== actorId && !canModerate) {
      throw new ForbiddenException('Not allowed to delete this comment');
    }
    await this.prisma.groupPostComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  private async assertActiveMember(groupId: string, userId: string) {
    const membership = await this.groups.getMembershipFor(groupId, userId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Only active members can do this');
    }
  }
}