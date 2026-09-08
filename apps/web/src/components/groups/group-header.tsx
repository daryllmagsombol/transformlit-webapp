'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apolloClient } from '../../lib/apollo-client';
import { resolveImageUrl, JOIN_GROUP_MUTATION, LEAVE_GROUP_MUTATION } from '../../lib/groups';
import { useToast } from '../ui';
import type { GraphQLGroup } from '@transformlit/shared';

const VISIBILITY_ICONS: Record<string, string> = {
  PUBLIC: 'public',
  PRIVATE: 'lock',
};

const TABS = ['posts', 'members', 'settings'] as const;

interface GroupHeaderProps {
  group: GraphQLGroup;
  onChanged: () => void;
  onTabChange: (tab: 'posts' | 'members' | 'settings') => void;
  activeTab: 'posts' | 'members' | 'settings';
}

export function GroupHeader({ group, onChanged, onTabChange, activeTab }: GroupHeaderProps) {
  const { addToast } = useToast();
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const isOwner = group.myRole === 'OWNER';
  const isActiveMember = group.myStatus === 'ACTIVE';
  const isPending = group.myStatus === 'PENDING';

  const handleJoin = useCallback(async () => {
    setActing(true);
    try {
      await apolloClient.mutate({
        mutation: JOIN_GROUP_MUTATION,
        variables: { groupId: group.id },
      });
      addToast(isPending ? 'Request sent.' : 'Joined group! Welcome aboard.', 'success');
      onChanged();
    } catch {
      addToast('Failed to join group. Please try again.', 'error');
    } finally {
      setActing(false);
    }
  }, [group.id, isPending, onChanged, addToast]);

  const handleLeave = useCallback(async () => {
    setShowLeaveConfirm(false);
    setActing(true);
    try {
      await apolloClient.mutate({
        mutation: LEAVE_GROUP_MUTATION,
        variables: { groupId: group.id },
      });
      addToast('You left the group.', 'info');
      if (isOwner) {
        router.push('/groups');
      } else {
        onChanged();
      }
    } catch {
      addToast('Failed to leave group. Please try again.', 'error');
    } finally {
      setActing(false);
    }
  }, [group.id, isOwner, onChanged, router, addToast]);

  const handleShare = useCallback(() => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(globalThis.window.location.href).then(
      () => addToast('Link copied to clipboard.', 'success'),
      () => addToast('Failed to copy link.', 'error'),
    );
  }, [addToast]);

  const coverUrl = resolveImageUrl(group.coverImageUrl);

  return (
    <section className="space-y-5">
      {/* Cover */}
      <div className="relative h-48 md:h-56 rounded-xl overflow-hidden bg-primary-container shadow-sm">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`${group.name} cover`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-6xl text-on-primary-container/40">diversity_3</span>
          </div>
        )}
      </div>

      {/* Meta + Name + Description + CTA */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 bg-surface-container rounded-full px-3 py-1 font-small text-small text-on-surface-variant border border-outline-variant/50">
              {group.category?.replace(/_/g, ' ') ?? 'Group'}
            </span>
            <span className="inline-flex items-center gap-1 bg-surface-container rounded-full px-3 py-1 font-small text-small text-on-surface-variant border border-outline-variant/50">
              <span className="material-symbols-outlined text-sm">{VISIBILITY_ICONS[group.visibility] ?? 'public'}</span>
              {group.visibility}
            </span>
            <span className="inline-flex items-center gap-1 font-small text-small text-on-surface-variant">
              <span className="material-symbols-outlined text-sm">group</span>
              {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
            </span>
          </div>
          <h1 className="font-display text-headline-h3 md:text-headline-h2 text-on-surface">{group.name}</h1>
          {group.description && (
            <p className="font-body text-body text-on-surface-variant max-w-2xl">{group.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant bg-surface-container text-on-surface font-small text-small hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-sm">share</span>
            Share
          </button>

          {isActiveMember ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm((s) => !s)}
                disabled={acting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant bg-surface-container text-on-surface font-small text-small hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-sm">check</span>
                Joined
                <span className="material-symbols-outlined text-sm">expand_more</span>
              </button>
              {showLeaveConfirm && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-surface rounded-xl shadow-lg border border-outline-variant p-2 z-20">
                  <button
                    type="button"
                    onClick={handleLeave}
                    disabled={acting}
                    className="w-full text-left px-3 py-2 rounded-lg font-small text-small text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Leave group
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={acting || isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-container text-on-primary-container font-small text-small font-semibold hover:bg-inverse-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-sm">{isPending ? 'schedule' : 'group_add'}</span>
              {isPending ? 'Request Pending' : 'Join Group'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface-container rounded-full p-1 inline-flex w-full md:w-auto">
        {TABS.map((tab) => {
          function isTabDisabled(): boolean {
            if (tab === 'members') return !isActiveMember && !isOwner && group.myRole !== 'MODERATOR';
            if (tab === 'settings') return !isOwner;
            return false;
          }
          function getTabClassName(): string {
            const base = 'flex-1 md:flex-none px-4 py-2 rounded-full font-small text-small font-semibold capitalize transition-colors min-w-[80px]';
            const active = activeTab === tab
              ? 'bg-primary-container text-on-primary-container'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high';
            const disabledClass = isTabDisabled() ? 'opacity-40 cursor-not-allowed' : '';
            return `${base} ${active} ${disabledClass}`;
          }
          return (
            <button
              key={tab}
              type="button"
              onClick={() => !isTabDisabled() && onTabChange(tab)}
              disabled={isTabDisabled()}
              className={getTabClassName()}
            >
              {tab}
            </button>
          );
        })}
      </div>
    </section>
  );
}
