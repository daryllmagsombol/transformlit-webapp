'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLGroupMember, GraphQLUser } from '@transformlit/shared';
import { useAuthStore } from '../../store';
import { useToast } from '../ui';
import {
  fetchGroupMembers,
  approveGroupMember,
  removeGroupMember,
  banGroupMember,
  unbanGroupMember,
  updateGroupMemberRole,
} from '../../lib/groups';
import { timeAgo } from '../../lib/time-ago';

function getMemberUserId(m: GraphQLGroupMember): string {
  return m.user.id;
}

interface GroupMembersProps {
  groupId: string;
  canModerate: boolean;
  isOwner: boolean;
}

function Avatar({ user, size = 40 }: { user: GraphQLUser; size?: number }) {
  const initial = user.displayName?.[0]?.toUpperCase() ?? '?';
  if (user.avatarUrl) {
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

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    OWNER: 'bg-primary-container text-on-primary-container',
    MODERATOR: 'bg-secondary-container text-on-secondary-container',
    MEMBER: 'bg-surface-container text-on-surface-variant',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 font-micro uppercase ${colors[role] ?? colors.MEMBER}`}>
      {role}
    </span>
  );
}

export function GroupMembers({ groupId, canModerate, isOwner }: GroupMembersProps) {
  const { addToast } = useToast();
  const currentUser = useAuthStore((s) => s.user);
  const [members, setMembers] = useState<GraphQLGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchGroupMembers(groupId);
      setMembers(list);
    } catch {
      addToast('Failed to load members.', 'error');
    } finally {
      setLoading(false);
    }
  }, [groupId, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const withRefresh = useCallback(
    (fn: () => Promise<void>) => async () => {
      try {
        await fn();
        await load();
      } catch {
        addToast('Action failed. Please try again.', 'error');
      }
    },
    [load, addToast],
  );

  const pending = members.filter((m) => m.status === 'PENDING');
  const active = members.filter((m) => m.status === 'ACTIVE');
  const banned = members.filter((m) => m.status === 'BANNED');

  return (
    <div className="space-y-6">
      {canModerate && pending.length > 0 && (
        <section className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-4">
          <h3 className="font-display text-headline-h3 text-on-surface mb-4">Pending requests</h3>
          <div className="space-y-3">
            {pending.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar user={m.user} />
                  <div>
                    <p className="font-small text-small font-medium text-on-surface">{m.user.displayName}</p>
                    <p className="font-micro text-micro text-on-surface-variant">Requested {timeAgo(m.joinedAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={withRefresh(() => removeGroupMember(groupId, getMemberUserId(m)))}
                    className="px-3 py-2 rounded-xl border border-outline-variant bg-surface-container text-on-surface font-small text-small hover:bg-surface-container-high transition-colors min-h-11"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={withRefresh(() => approveGroupMember(groupId, getMemberUserId(m)))}
                    className="px-3 py-2 rounded-xl bg-primary-container text-on-primary-container font-small text-small font-semibold hover:bg-inverse-primary transition-colors min-h-11"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-4">
        <h3 className="font-display text-headline-h3 text-on-surface mb-4">Members</h3>
        {loading ? (
          <div className="space-y-3">
            <div className="h-12 bg-surface-container rounded-xl animate-pulse" />
            <div className="h-12 bg-surface-container rounded-xl animate-pulse" />
          </div>
        ) : (
          <div className="space-y-3">
            {[...active, ...banned].map((m) => {
              const isSelf = currentUser?.id === getMemberUserId(m);
              const isTargetOwner = m.role === 'OWNER';
              const showMenu = canModerate && !isSelf && !isTargetOwner;
              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between gap-3 p-2 rounded-xl ${
                    m.status === 'BANNED' ? 'opacity-60 bg-surface-container/50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar user={m.user} />
                    <div className="min-w-0">
                      <p className="font-small text-small font-medium text-on-surface truncate">
                        {m.user.displayName} {isSelf && '(You)'}
                      </p>
                      <div className="flex items-center gap-2">
                        <RoleBadge role={m.role} />
                        {m.status === 'BANNED' && (
                          <span className="font-micro text-micro text-red-500">Banned</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {showMenu && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setOpenMenuId((id) => (id === m.id ? null : m.id))}
                        className="p-2 rounded-full text-on-surface-variant hover:bg-surface-container transition-colors min-h-11 min-w-11 flex items-center justify-center"
                        aria-label="Member options"
                      >
                        <span className="material-symbols-outlined">more_vert</span>
                      </button>
                      {openMenuId === m.id && (
                        <div className="absolute right-0 top-full mt-1 w-48 bg-surface rounded-xl shadow-lg border border-outline-variant p-1 z-10">
                          {isOwner && m.role === 'MEMBER' && (
                            <button
                              type="button"
                              onClick={withRefresh(() => updateGroupMemberRole(groupId, getMemberUserId(m), 'MODERATOR'))}
                              className="w-full text-left px-3 py-2 rounded-lg font-small text-small text-on-surface hover:bg-surface-container"
                            >
                              Promote to Moderator
                            </button>
                          )}
                          {isOwner && m.role === 'MODERATOR' && (
                            <button
                              type="button"
                              onClick={withRefresh(() => updateGroupMemberRole(groupId, getMemberUserId(m), 'MEMBER'))}
                              className="w-full text-left px-3 py-2 rounded-lg font-small text-small text-on-surface hover:bg-surface-container"
                            >
                              Demote to Member
                            </button>
                          )}
                          {m.status === 'BANNED' ? (
                            <button
                              type="button"
                              onClick={withRefresh(() => unbanGroupMember(groupId, getMemberUserId(m)))}
                              className="w-full text-left px-3 py-2 rounded-lg font-small text-small text-on-surface hover:bg-surface-container"
                            >
                              Unban
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={withRefresh(() => banGroupMember(groupId, getMemberUserId(m)))}
                              className="w-full text-left px-3 py-2 rounded-lg font-small text-small text-red-600 hover:bg-red-50"
                            >
                              Ban
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={withRefresh(() => removeGroupMember(groupId, getMemberUserId(m)))}
                            className="w-full text-left px-3 py-2 rounded-lg font-small text-small text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
