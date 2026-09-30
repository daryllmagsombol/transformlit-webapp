/// <reference types="jest" />
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GroupPostsService } from './group-posts.service';

const mockPost = {
  id: 'post-1',
  groupId: 'group-1',
  authorId: 'user-1',
  body: 'Hello world',
  imageKey: null,
  createdAt: new Date('2024-01-01'),
  deletedAt: null,
  author: { id: 'user-1', displayName: 'Test User', avatarUrl: null },
  _count: { likes: 2, comments: 3 },
  likes: [{ id: 'like-1' }],
};

const mockComment = {
  id: 'comment-1',
  postId: 'post-1',
  authorId: 'user-1',
  body: 'A comment',
  createdAt: new Date('2024-01-01'),
  deletedAt: null,
};

const activeMember = { status: 'ACTIVE', role: 'MEMBER' };

describe('GroupPostsService', () => {
  let service: GroupPostsService;
  let prisma: any;
  let groups: any;

  beforeEach(() => {
    prisma = {
      groupPost: {
        findMany: jest.fn().mockResolvedValue([mockPost]),
        findUnique: jest.fn().mockResolvedValue(mockPost),
        create: jest.fn().mockResolvedValue(mockPost),
        update: jest.fn().mockResolvedValue(mockPost),
      },
      groupPostLike: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'like-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'like-1' }),
      },
      groupPostComment: {
        findMany: jest.fn().mockResolvedValue([mockComment]),
        findUnique: jest.fn().mockResolvedValue(mockComment),
        create: jest.fn().mockResolvedValue(mockComment),
        update: jest.fn().mockResolvedValue(mockComment),
      },
    };

    groups = {
      getMembershipFor: jest.fn().mockResolvedValue(activeMember),
    };

    service = new GroupPostsService(prisma as any, groups as any);
    jest.clearAllMocks();

    prisma.groupPost.findMany.mockResolvedValue([mockPost]);
    prisma.groupPost.findUnique.mockResolvedValue(mockPost);
    prisma.groupPost.create.mockResolvedValue(mockPost);
    prisma.groupPost.update.mockResolvedValue(mockPost);
    prisma.groupPostLike.findUnique.mockResolvedValue(null);
    prisma.groupPostLike.create.mockResolvedValue({ id: 'like-1' });
    prisma.groupPostLike.delete.mockResolvedValue({ id: 'like-1' });
    prisma.groupPostComment.findMany.mockResolvedValue([mockComment]);
    prisma.groupPostComment.findUnique.mockResolvedValue(mockComment);
    prisma.groupPostComment.create.mockResolvedValue(mockComment);
    prisma.groupPostComment.update.mockResolvedValue(mockComment);
    groups.getMembershipFor.mockResolvedValue(activeMember);
  });

  // ── listPosts ───────────────────────────────────────────────────────────────

  describe('listPosts', () => {
    it('should require an ACTIVE membership before listing', async () => {
      await service.listPosts('group-1', 'user-1');
      expect(groups.getMembershipFor).toHaveBeenCalledWith('group-1', 'user-1');
      expect(prisma.groupPost.findMany).toHaveBeenCalled();
    });

    it('should reject a non-ACTIVE actor with ForbiddenException', async () => {
      groups.getMembershipFor.mockResolvedValue({ status: 'PENDING', role: 'MEMBER' });
      await expect(service.listPosts('group-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupPost.findMany).not.toHaveBeenCalled();
    });

    it('should reject a missing membership with ForbiddenException', async () => {
      groups.getMembershipFor.mockResolvedValue(null);
      await expect(service.listPosts('group-1', 'user-1')).rejects.toThrow(
        'Only active members can do this',
      );
    });

    it('should query non-deleted posts ordered by createdAt desc', async () => {
      await service.listPosts('group-1', 'user-1');
      expect(prisma.groupPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'group-1', deletedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should apply default offset 0 and limit 20', async () => {
      await service.listPosts('group-1', 'user-1');
      expect(prisma.groupPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('should clamp a negative offset to 0', async () => {
      await service.listPosts('group-1', 'user-1', -50, 20);
      expect(prisma.groupPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('should clamp an offset above MAX_PAGE_OFFSET to 10000', async () => {
      await service.listPosts('group-1', 'user-1', 999_999, 20);
      expect(prisma.groupPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10_000 }),
      );
    });

    it('should clamp a limit below 1 to 1', async () => {
      await service.listPosts('group-1', 'user-1', 0, 0);
      expect(prisma.groupPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });

    it('should clamp a limit above 50 to 50', async () => {
      await service.listPosts('group-1', 'user-1', 0, 500);
      expect(prisma.groupPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should map posts through mapPost', async () => {
      const result = await service.listPosts('group-1', 'user-1');
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'post-1',
          likeCount: 2,
          commentCount: 3,
          likedByMe: true,
          likes: undefined,
          _count: undefined,
        }),
      );
    });

    it('should default counts to 0 and likedByMe to false when relations are missing', async () => {
      prisma.groupPost.findMany.mockResolvedValue([
        { ...mockPost, _count: undefined, likes: [] },
      ]);
      const result = await service.listPosts('group-1', 'user-1');
      expect(result[0].likeCount).toBe(0);
      expect(result[0].commentCount).toBe(0);
      expect(result[0].likedByMe).toBe(false);
    });

    it('should return an empty array when there are no posts', async () => {
      prisma.groupPost.findMany.mockResolvedValue([]);
      const result = await service.listPosts('group-1', 'user-1');
      expect(result).toEqual([]);
    });
  });

  // ── createPost ──────────────────────────────────────────────────────────────

  describe('createPost', () => {
    it('should require an ACTIVE membership before creating', async () => {
      groups.getMembershipFor.mockResolvedValue({ status: 'BANNED', role: 'MEMBER' });
      await expect(
        service.createPost('group-1', 'user-1', { body: 'Hi' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.groupPost.create).not.toHaveBeenCalled();
    });

    it('should trim the body before persisting', async () => {
      await service.createPost('group-1', 'user-1', { body: '  hello  ' });
      expect(prisma.groupPost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ body: 'hello' }),
        }),
      );
    });

    it('should reject an empty body with BadRequestException', async () => {
      await expect(
        service.createPost('group-1', 'user-1', { body: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.groupPost.create).not.toHaveBeenCalled();
    });

    it('should persist the groupId and authorId', async () => {
      await service.createPost('group-1', 'user-1', { body: 'Hi' });
      expect(prisma.groupPost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ groupId: 'group-1', authorId: 'user-1' }),
        }),
      );
    });

    it('should default imageKey to null when omitted', async () => {
      await service.createPost('group-1', 'user-1', { body: 'Hi' });
      expect(prisma.groupPost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ imageKey: null }),
        }),
      );
    });

    it('should persist a provided imageKey', async () => {
      await service.createPost('group-1', 'user-1', { body: 'Hi', imageKey: 'img/1.png' });
      expect(prisma.groupPost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ imageKey: 'img/1.png' }),
        }),
      );
    });

    it('should return the mapped post', async () => {
      const result = await service.createPost('group-1', 'user-1', { body: 'Hi' });
      expect(result).toEqual(
        expect.objectContaining({ likeCount: 2, commentCount: 3, likedByMe: true }),
      );
    });
  });

  // ── deletePost ──────────────────────────────────────────────────────────────

  describe('deletePost', () => {
    it('should throw NotFoundException when the post is missing', async () => {
      prisma.groupPost.findUnique.mockResolvedValue(null);
      await expect(service.deletePost('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.groupPost.update).not.toHaveBeenCalled();
    });

    it('should allow the author to soft delete their own post', async () => {
      prisma.groupPost.findUnique.mockResolvedValue({ ...mockPost, authorId: 'user-1' });
      const result = await service.deletePost('post-1', 'user-1');
      expect(result).toBe(true);
      expect(prisma.groupPost.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should allow an ACTIVE owner to delete another user post', async () => {
      prisma.groupPost.findUnique.mockResolvedValue({ ...mockPost, authorId: 'other' });
      groups.getMembershipFor.mockResolvedValue({ status: 'ACTIVE', role: 'OWNER' });
      const result = await service.deletePost('post-1', 'mod-1');
      expect(result).toBe(true);
      expect(prisma.groupPost.update).toHaveBeenCalled();
    });

    it('should allow an ACTIVE moderator to delete another user post', async () => {
      prisma.groupPost.findUnique.mockResolvedValue({ ...mockPost, authorId: 'other' });
      groups.getMembershipFor.mockResolvedValue({ status: 'ACTIVE', role: 'MODERATOR' });
      const result = await service.deletePost('post-1', 'mod-1');
      expect(result).toBe(true);
      expect(prisma.groupPost.update).toHaveBeenCalled();
    });

    it('should forbid a plain ACTIVE member deleting another user post', async () => {
      prisma.groupPost.findUnique.mockResolvedValue({ ...mockPost, authorId: 'other' });
      groups.getMembershipFor.mockResolvedValue(activeMember);
      await expect(service.deletePost('post-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupPost.update).not.toHaveBeenCalled();
    });

    it('should forbid a non-member deleting another user post', async () => {
      prisma.groupPost.findUnique.mockResolvedValue({ ...mockPost, authorId: 'other' });
      groups.getMembershipFor.mockResolvedValue(null);
      await expect(service.deletePost('post-1', 'user-1')).rejects.toThrow(
        'Not allowed to delete this post',
      );
    });
  });

  // ── toggleLike ──────────────────────────────────────────────────────────────

  describe('toggleLike', () => {
    it('should throw NotFoundException when the post is missing', async () => {
      prisma.groupPost.findUnique.mockResolvedValue(null);
      await expect(service.toggleLike('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should require an ACTIVE membership after finding the post', async () => {
      groups.getMembershipFor.mockResolvedValue({ status: 'BANNED', role: 'MEMBER' });
      await expect(service.toggleLike('post-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupPostLike.create).not.toHaveBeenCalled();
    });

    it('should create a like and return true when none exists', async () => {
      prisma.groupPostLike.findUnique.mockResolvedValue(null);
      const result = await service.toggleLike('post-1', 'user-1');
      expect(result).toBe(true);
      expect(prisma.groupPostLike.create).toHaveBeenCalledWith({
        data: { postId: 'post-1', userId: 'user-1' },
      });
      expect(prisma.groupPostLike.delete).not.toHaveBeenCalled();
    });

    it('should delete the existing like and return false', async () => {
      prisma.groupPostLike.findUnique.mockResolvedValue({ id: 'like-9' });
      const result = await service.toggleLike('post-1', 'user-1');
      expect(result).toBe(false);
      expect(prisma.groupPostLike.delete).toHaveBeenCalledWith({
        where: { id: 'like-9' },
      });
      expect(prisma.groupPostLike.create).not.toHaveBeenCalled();
    });
  });

  // ── listComments ────────────────────────────────────────────────────────────

  describe('listComments', () => {
    it('should throw NotFoundException when the post is missing', async () => {
      prisma.groupPost.findUnique.mockResolvedValue(null);
      await expect(service.listComments('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.groupPostComment.findMany).not.toHaveBeenCalled();
    });

    it('should require an ACTIVE membership', async () => {
      groups.getMembershipFor.mockResolvedValue({ status: 'PENDING', role: 'MEMBER' });
      await expect(service.listComments('post-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should query non-deleted comments for the post ordered by createdAt asc', async () => {
      await service.listComments('post-1', 'user-1');
      expect(prisma.groupPostComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { postId: 'post-1', deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, displayName: true, avatarUrl: true } },
          },
        }),
      );
    });

    it('should return the comments', async () => {
      const result = await service.listComments('post-1', 'user-1');
      expect(result).toEqual([mockComment]);
    });
  });

  // ── createComment ───────────────────────────────────────────────────────────

  describe('createComment', () => {
    it('should throw NotFoundException when the post is missing', async () => {
      prisma.groupPost.findUnique.mockResolvedValue(null);
      await expect(service.createComment('post-1', 'user-1', 'Hi')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should require an ACTIVE membership', async () => {
      groups.getMembershipFor.mockResolvedValue({ status: 'BANNED', role: 'MEMBER' });
      await expect(service.createComment('post-1', 'user-1', 'Hi')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupPostComment.create).not.toHaveBeenCalled();
    });

    it('should reject an empty comment with BadRequestException', async () => {
      await expect(service.createComment('post-1', 'user-1', '   ')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.groupPostComment.create).not.toHaveBeenCalled();
    });

    it('should reject a comment longer than 2000 characters', async () => {
      const tooLong = 'a'.repeat(2001);
      await expect(service.createComment('post-1', 'user-1', tooLong)).rejects.toThrow(
        'Comment is too long',
      );
      expect(prisma.groupPostComment.create).not.toHaveBeenCalled();
    });

    it('should accept a comment at exactly 2000 characters', async () => {
      const atLimit = 'a'.repeat(2000);
      await service.createComment('post-1', 'user-1', atLimit);
      expect(prisma.groupPostComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ body: atLimit }),
        }),
      );
    });

    it('should trim and persist the comment', async () => {
      await service.createComment('post-1', 'user-1', '  hi  ');
      expect(prisma.groupPostComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { postId: 'post-1', authorId: 'user-1', body: 'hi' },
        }),
      );
    });

    it('should return the created comment', async () => {
      const result = await service.createComment('post-1', 'user-1', 'hi');
      expect(result).toEqual(mockComment);
    });
  });

  // ── deleteComment ───────────────────────────────────────────────────────────

  describe('deleteComment', () => {
    it('should throw NotFoundException when the comment is missing', async () => {
      prisma.groupPostComment.findUnique.mockResolvedValue(null);
      await expect(service.deleteComment('comment-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.groupPostComment.update).not.toHaveBeenCalled();
    });

    it('should allow the author to soft delete their own comment', async () => {
      prisma.groupPostComment.findUnique.mockResolvedValue({
        ...mockComment,
        authorId: 'user-1',
      });
      const result = await service.deleteComment('comment-1', 'user-1');
      expect(result).toBe(true);
      expect(prisma.groupPostComment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should resolve the group via the comment postId', async () => {
      prisma.groupPostComment.findUnique.mockResolvedValue({
        ...mockComment,
        postId: 'post-42',
      });
      await service.deleteComment('comment-1', 'user-1');
      expect(prisma.groupPost.findUnique).toHaveBeenCalledWith({
        where: { id: 'post-42' },
      });
    });

    it('should allow an ACTIVE owner to delete another user comment', async () => {
      prisma.groupPostComment.findUnique.mockResolvedValue({
        ...mockComment,
        authorId: 'other',
      });
      groups.getMembershipFor.mockResolvedValue({ status: 'ACTIVE', role: 'OWNER' });
      const result = await service.deleteComment('comment-1', 'mod-1');
      expect(result).toBe(true);
      expect(prisma.groupPostComment.update).toHaveBeenCalled();
    });

    it('should allow an ACTIVE moderator to delete another user comment', async () => {
      prisma.groupPostComment.findUnique.mockResolvedValue({
        ...mockComment,
        authorId: 'other',
      });
      groups.getMembershipFor.mockResolvedValue({ status: 'ACTIVE', role: 'MODERATOR' });
      const result = await service.deleteComment('comment-1', 'mod-1');
      expect(result).toBe(true);
      expect(prisma.groupPostComment.update).toHaveBeenCalled();
    });

    it('should forbid a plain ACTIVE member deleting another user comment', async () => {
      prisma.groupPostComment.findUnique.mockResolvedValue({
        ...mockComment,
        authorId: 'other',
      });
      groups.getMembershipFor.mockResolvedValue(activeMember);
      await expect(service.deleteComment('comment-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupPostComment.update).not.toHaveBeenCalled();
    });

    it('should forbid a non-member deleting another user comment', async () => {
      prisma.groupPostComment.findUnique.mockResolvedValue({
        ...mockComment,
        authorId: 'other',
      });
      groups.getMembershipFor.mockResolvedValue(null);
      await expect(service.deleteComment('comment-1', 'user-1')).rejects.toThrow(
        'Not allowed to delete this comment',
      );
    });
  });
});
