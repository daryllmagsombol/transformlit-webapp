'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChatStore } from '../../store/chat-store';
import { fetchConversations, ChatConversation } from '../../lib/chat-queries';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { UserAvatar, LoadingSpinner } from '../ui';
import { relativeTime } from '../../lib/time';

export function ConversationList() {
  const { isReady } = useRequireAuth();
  const pathname = usePathname();
  const conversations = useChatStore((s) => s.conversations);
  const setConversations = useChatStore((s) => s.setConversations);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isReady) return;
    fetchConversations()
      .then(setConversations)
      .catch(() => {
        // toast-free: list page shows empty state; provider refetch recovers
      })
      .finally(() => setLoading(false));
  }, [isReady, setConversations]);

  const title = (c: ChatConversation) =>
    c.type === 'GROUP' ? c.group?.name ?? 'Group' : c.otherUser?.displayName ?? 'User';

  if (!isReady || loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface-container-high rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center text-center">
        <span className="material-symbols-outlined text-[64px] text-primary opacity-40 mb-4">forum</span>
        <h3 className="font-display font-headline-h3 text-on-surface mb-2">No conversations yet</h3>
        <p className="font-body text-on-surface-variant max-w-xs mb-4">
          Message a friend from their profile to start chatting.
        </p>
        <Link
          href="/friends"
          className="font-display font-headline-h4 px-6 h-11 rounded-md bg-brand-orange-dark text-on-primary flex items-center gap-2 shadow-sm hover:brightness-110 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">group</span>
          Find friends
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Conversations">
      {conversations.map((c) => {
        const active = pathname === `/chat/${c.id}`;
        return (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}`}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                active
                  ? 'bg-primary-container/60 border-primary'
                  : 'bg-surface-container-lowest border-outline-variant hover:border-primary'
              }`}
            >
              {c.type === 'GROUP' ? (
                <div className="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center overflow-hidden shrink-0">
                  <span className="material-symbols-outlined text-base text-on-primary-container">diversity_3</span>
                </div>
              ) : (
                <UserAvatar
                  avatarUrl={c.otherUser?.avatarUrl}
                  displayName={c.otherUser?.displayName}
                  size="md"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display font-headline-h4 text-on-surface truncate">{title(c)}</p>
                  {c.lastMessage && (
                    <span className="font-micro text-[10px] text-on-surface-variant shrink-0">
                      {relativeTime(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-body-mobile text-sm text-on-surface-variant line-clamp-1 flex-1">
                    {c.lastMessage ? c.lastMessage.body : 'Say hello!'}
                  </p>
                  {c.unreadCount > 0 && (
                    <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-brand-orange-dark text-white font-bold text-[10px] shrink-0">
                      {c.unreadCount > 9 ? '9+' : c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}