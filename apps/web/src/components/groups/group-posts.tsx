'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLGroup, GraphQLGroupPost } from '@transformlit/shared';
import { useAuthStore } from '../../store';
import { fetchGroupPosts } from '../../lib/groups';
import { PostComposer } from './post-composer';
import { PostCard } from './post-card';

interface GroupPostsProps {
  readonly group: GraphQLGroup;
  readonly onChanged: () => void;
}

export function GroupPosts({ group, onChanged }: GroupPostsProps) {
  const currentUser = useAuthStore((s) => s.user);
  const [posts, setPosts] = useState<GraphQLGroupPost[]>([]);
  const [loading, setLoading] = useState(true);

  const isActiveMember = group.myStatus === 'ACTIVE';
  const canModerate = group.myRole === 'OWNER' || group.myRole === 'MODERATOR';

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchGroupPosts(group.id);
      setPosts(list);
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handlePosted = useCallback(() => {
    loadPosts();
    onChanged();
  }, [loadPosts, onChanged]);

  return (
    <div className="space-y-4">
      {isActiveMember ? (
        <PostComposer groupId={group.id} onPosted={handlePosted} />
      ) : (
        <div className="bg-surface-container rounded-xl p-4 flex items-center gap-3 text-on-surface-variant">
          <span className="material-symbols-outlined">lock</span>
          <p className="font-body text-body">Join the group to post and interact.</p>
        </div>
      )}

      {(() => {
        if (loading) {
          return (
            <div className="space-y-4">
              <div className="h-40 bg-surface-container rounded-xl animate-pulse" />
              <div className="h-40 bg-surface-container rounded-xl animate-pulse" />
            </div>
          );
        }
        if (posts.length === 0) {
          return (
            <div className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-8 text-center">
              <p className="font-body text-body text-on-surface-variant">
                No posts yet — be the first to share.
              </p>
            </div>
          );
        }
        return posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            canModerate={canModerate}
            currentUser={currentUser}
            onChanged={loadPosts}
          />
        ));
      })()}
    </div>
  );
}
