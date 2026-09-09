'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLGroup } from '@transformlit/shared';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { LoadingSpinner } from '../ui';
import { fetchGroupBySlug } from '../../lib/groups';
import { GroupHeader } from './group-header';
import { GroupPosts } from './group-posts';
import { GroupMembers } from './group-members';
import { GroupSettings } from './group-settings';

export function GroupDetailClient({ slug }: { readonly slug: string }) {
  const { isReady } = useRequireAuth();
  const [group, setGroup] = useState<GraphQLGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'posts' | 'members' | 'settings'>('posts');

  const load = useCallback(async () => {
    setLoading(true);
    const g = await fetchGroupBySlug(slug);
    setGroup(g);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    if (isReady) load();
  }, [isReady, load]);

  if (!isReady || loading || !group) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  const isOwner = group.myRole === 'OWNER';
  const canModerate = group.myRole === 'OWNER' || group.myRole === 'MODERATOR';
  const isActiveMember = group.myStatus === 'ACTIVE';

  return (
    <div className="space-y-6">
      <GroupHeader
        group={group}
        onChanged={load}
        onTabChange={setTab}
        activeTab={tab}
      />
      {tab === 'posts' &&
        (isActiveMember ? (
          <GroupPosts group={group} onChanged={load} />
        ) : (
          <div className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">lock</span>
            <p className="font-body text-body text-on-surface-variant">
              Join this group to see posts and join the conversation.
            </p>
          </div>
        ))}
      {tab === 'members' && isActiveMember && (
        <GroupMembers groupId={group.id} canModerate={canModerate} isOwner={isOwner} />
      )}
      {tab === 'settings' && isOwner && (
        <GroupSettings group={group} onChanged={load} />
      )}
    </div>
  );
}
