/// <reference types="jest" />
import { GroupPostsResolver } from './group-posts.resolver';
import { GroupPostsService } from './group-posts.service';

const mockPost = {
  id: 'post-1',
  groupId: 'group-1',
  body: 'Hello world',
  likeCount: 2,
  commentCount: 3,
  likedByMe: true,
  createdAt: new Date('2024-01-01'),
};

const mockComment = {
  id: 'comment-1',
  postId: 'post-1',
  body: 'A comment',
  createdAt: new Date('2024-01-01'),
};

const mockUser = { id: 'user-1' };

describe('GroupPostsResolver', () => {
  let resolver: GroupPostsResolver;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    const mockService = {
      listPosts: jest.fn().mockResolvedValue([mockPost]),
      listComments: jest.fn().mockResolvedValue([mockComment]),
      createPost: jest.fn().mockResolvedValue(mockPost),
      deletePost: jest.fn().mockResolvedValue(true),
      toggleLike: jest.fn().mockResolvedValue(true),
      createComment: jest.fn().mockResolvedValue(mockComment),
      deleteComment: jest.fn().mockResolvedValue(true),
    };

    resolver = new GroupPostsResolver(mockService as any);
    service = mockService;
    jest.clearAllMocks();
  });

  // ── groupPosts query ────────────────────────────────────────────────────────

  describe('groupPosts', () => {
    it('should delegate to listPosts with groupId, user id, offset, and limit', async () => {
      const result = await resolver.groupPosts(mockUser, 'group-1', 0, 20);
      expect(service.listPosts).toHaveBeenCalledWith('group-1', 'user-1', 0, 20);
      expect(result).toEqual([mockPost]);
    });

    it('should forward custom pagination arguments', async () => {
      await resolver.groupPosts(mockUser, 'group-1', 40, 10);
      expect(service.listPosts).toHaveBeenCalledWith('group-1', 'user-1', 40, 10);
    });
  });

  // ── groupPostComments query ─────────────────────────────────────────────────

  describe('groupPostComments', () => {
    it('should delegate to listComments with postId and user id', async () => {
      const result = await resolver.groupPostComments(mockUser, 'post-1');
      expect(service.listComments).toHaveBeenCalledWith('post-1', 'user-1');
      expect(result).toEqual([mockComment]);
    });
  });

  // ── createGroupPost mutation ────────────────────────────────────────────────

  describe('createGroupPost', () => {
    it('should delegate to createPost with groupId, user id, and input', async () => {
      const input = { body: 'New post' };
      const result = await resolver.createGroupPost(mockUser, 'group-1', input);
      expect(service.createPost).toHaveBeenCalledWith('group-1', 'user-1', input);
      expect(result).toEqual(mockPost);
    });

    it('should forward the optional imageKey', async () => {
      const input = { body: 'New post', imageKey: 'img/1.png' };
      await resolver.createGroupPost(mockUser, 'group-1', input);
      expect(service.createPost).toHaveBeenCalledWith('group-1', 'user-1', input);
    });
  });

  // ── deleteGroupPost mutation ────────────────────────────────────────────────

  describe('deleteGroupPost', () => {
    it('should delegate to deletePost with postId and user id', async () => {
      const result = await resolver.deleteGroupPost(mockUser, 'post-1');
      expect(service.deletePost).toHaveBeenCalledWith('post-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  // ── toggleGroupPostLike mutation ────────────────────────────────────────────

  describe('toggleGroupPostLike', () => {
    it('should delegate to toggleLike with postId and user id', async () => {
      const result = await resolver.toggleGroupPostLike(mockUser, 'post-1');
      expect(service.toggleLike).toHaveBeenCalledWith('post-1', 'user-1');
      expect(result).toBe(true);
    });

    it('should return false when the service unlikes', async () => {
      service.toggleLike.mockResolvedValue(false);
      const result = await resolver.toggleGroupPostLike(mockUser, 'post-1');
      expect(result).toBe(false);
    });
  });

  // ── createGroupPostComment mutation ─────────────────────────────────────────

  describe('createGroupPostComment', () => {
    it('should delegate to createComment with postId, user id, and body', async () => {
      const result = await resolver.createGroupPostComment(mockUser, 'post-1', 'Nice');
      expect(service.createComment).toHaveBeenCalledWith('post-1', 'user-1', 'Nice');
      expect(result).toEqual(mockComment);
    });
  });

  // ── deleteGroupPostComment mutation ─────────────────────────────────────────

  describe('deleteGroupPostComment', () => {
    it('should delegate to deleteComment with commentId and user id', async () => {
      const result = await resolver.deleteGroupPostComment(mockUser, 'comment-1');
      expect(service.deleteComment).toHaveBeenCalledWith('comment-1', 'user-1');
      expect(result).toBe(true);
    });
  });
});
