'use client';

import type { GraphQLGroup } from '@transformlit/shared';

interface GroupPostsProps {
  group: GraphQLGroup;
  onChanged: () => void;
}

export function GroupPosts({ group }: GroupPostsProps) {
  return (
    <div className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-8 text-center">
      <p className="font-body text-body text-on-surface-variant">Posts coming soon.</p>
    </div>
  );
}
