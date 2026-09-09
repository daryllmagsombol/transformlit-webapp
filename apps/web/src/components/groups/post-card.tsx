'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLGroupPost, GraphQLGroupPostComment, GraphQLUser } from '@transformlit/shared';
import {
  resolveImageUrl,
  toggleGroupPostLike,
  deleteGroupPost,
  fetchGroupPostComments,
  createGroupPostComment,
  deleteGroupPostComment,
} from '../../lib/groups';
import { timeAgo } from '../../lib/time-ago';
import { useToast } from '../ui';

interface PostCardProps {
  readonly post: GraphQLGroupPost;
  readonly canModerate: boolean;
  readonly currentUser: GraphQLUser | null;
  readonly onChanged: () => void;
}

function Avatar({ user, size = 40 }: { readonly user?: GraphQLUser | null; readonly size?: number }) {
  const initial = user?.displayName?.[0]?.toUpperCase() ?? '?';
  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
    );
  }
  return (
    <div
      className="rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-small font-semibold"
      style={{ width: size, height: size }}
    >
      {initial}
    </div>
  );
}

export function PostCard({ post, canModerate, currentUser, onChanged }: PostCardProps) {
  const { addToast } = useToast();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [comments, setComments] = useState<GraphQLGroupPostComment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setLiked(post.likedByMe);
    setLikeCount(post.likeCount);
  }, [post.likedByMe, post.likeCount]);

  const loadComments = useCallback(async () => {
    try {
      const list = await fetchGroupPostComments(post.id);
      setComments(list);
    } catch {
      addToast('Failed to load comments.', 'error');
    }
  }, [post.id, addToast]);

  useEffect(() => {
    if (commentsOpen) loadComments();
  }, [commentsOpen, loadComments]);

  const handleLike = useCallback(async () => {
    const originalLiked = liked;
    const originalLikeCount = likeCount;
    const nextLiked = !liked;
    const nextCount = nextLiked ? likeCount + 1 : Math.max(0, likeCount - 1);
    setLiked(nextLiked);
    setLikeCount(nextCount);
    try {
      const result = await toggleGroupPostLike(post.id);
      setLiked(result);
      setLikeCount(result ? originalLikeCount + 1 : Math.max(0, originalLikeCount - 1));
    } catch {
      setLiked(() => originalLiked);
      setLikeCount(() => originalLikeCount);
      addToast('Failed to update like.', 'error');
    }
  }, [liked, likeCount, post.id, addToast]);

  const handleDeletePost = useCallback(async () => {
    if (!globalThis.window.confirm('Delete this post?')) return;
    try {
      await deleteGroupPost(post.id);
      onChanged();
    } catch {
      addToast('Failed to delete post.', 'error');
    }
  }, [post.id, onChanged, addToast]);

  const handleAddComment = useCallback(
    async (e?: React.SyntheticEvent<HTMLFormElement>) => {
      e?.preventDefault();
      const trimmed = commentBody.trim();
      if (!trimmed) return;
      setSubmittingComment(true);
      try {
        await createGroupPostComment(post.id, trimmed);
        setCommentBody('');
        await loadComments();
      } catch {
        addToast('Failed to add comment.', 'error');
      } finally {
        setSubmittingComment(false);
      }
    },
    [commentBody, post.id, loadComments, addToast],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      if (!globalThis.window.confirm('Delete this comment?')) return;
      try {
        await deleteGroupPostComment(commentId);
        await loadComments();
      } catch {
        addToast('Failed to delete comment.', 'error');
      }
    },
    [loadComments, addToast],
  );

  const isAuthor = currentUser?.id === post.author?.id;
  const canDeletePost = isAuthor || canModerate;

  const imageUrl = resolveImageUrl(post.imageKey);

  return (
    <article className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar user={post.author} />
          <div>
            <p className="font-small text-small font-medium text-on-surface">{post.author?.displayName ?? 'Unknown'}</p>
            <p className="font-micro text-micro text-on-surface-variant">{timeAgo(post.createdAt)}</p>
          </div>
        </div>
        {canDeletePost && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((s) => !s)}
              className="p-2 rounded-full text-on-surface-variant hover:bg-surface-container transition-colors"
              aria-label="Post options"
            >
              <span className="material-symbols-outlined">more_vert</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-surface rounded-xl shadow-lg border border-outline-variant p-1 z-10">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    handleDeletePost();
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg font-small text-small text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <p className="font-body text-body text-on-surface whitespace-pre-wrap">{post.body}</p>

      {/* Image */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt="Post attachment"
          className="rounded-xl w-full object-cover max-h-96 border border-outline-variant"
        />
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 pt-1 border-t border-outline-variant/50">
        <button
          type="button"
          onClick={handleLike}
          className={`inline-flex items-center gap-1.5 font-small text-small transition-colors ${
            liked ? 'text-red-500' : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined">{liked ? 'favorite' : 'favorite_border'}</span>
          {likeCount}
        </button>
        <button
          type="button"
          onClick={() => setCommentsOpen((s) => !s)}
          className="inline-flex items-center gap-1.5 font-small text-small text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">chat_bubble_outline</span>
          {post.commentCount}
        </button>
      </div>

      {/* Comments */}
      {commentsOpen && (
        <div className="space-y-3 pt-2">
          {comments.length === 0 && (
            <p className="font-small text-small text-on-surface-variant">No comments yet.</p>
          )}
          {comments.map((comment) => {
            const canDeleteComment =
              currentUser?.id === comment.author?.id || canModerate;
            return (
              <div key={comment.id} className="flex items-start gap-2">
                <Avatar user={comment.author} size={28} />
                <div className="flex-1 bg-surface-container rounded-xl px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-small text-small font-medium text-on-surface">
                      {comment.author?.displayName ?? 'Unknown'}
                    </span>
                    <span className="font-micro text-micro text-on-surface-variant">
                      {timeAgo(comment.createdAt)}
                    </span>
                  </div>
                  <p className="font-body text-body text-on-surface">{comment.body}</p>
                </div>
                {canDeleteComment && (
                  <button
                    type="button"
                    onClick={() => handleDeleteComment(comment.id)}
                    className="p-2 text-on-surface-variant hover:text-red-500 transition-colors"
                    aria-label="Delete comment"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                )}
              </div>
            );
          })}

          <form onSubmit={handleAddComment} className="flex items-center gap-2">
            <input
              type="text"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Write a comment…"
              className="flex-1 bg-surface-container rounded-full px-4 py-2 font-body text-body text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary-container"
            />
            <button
              type="submit"
              disabled={!commentBody.trim() || submittingComment}
              className="p-2 rounded-full bg-primary-container text-on-primary-container disabled:opacity-60"
              aria-label="Send comment"
            >
              <span className="material-symbols-outlined">send</span>
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
