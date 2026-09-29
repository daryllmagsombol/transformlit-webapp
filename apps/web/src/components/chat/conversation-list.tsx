'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useChatStore } from '../../store/chat-store';
import { fetchConversations, ChatConversation } from '../../lib/chat-queries';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { useToast } from '../ui';
import { Stagger, StaggerItem } from '../ui/stagger';
import { relativeTime } from '../../lib/time';

function conversationTitle(c: ChatConversation): string {
  return c.type === 'GROUP' ? c.group?.name ?? 'Group' : c.otherUser?.displayName ?? 'User';
}

function unreadLabel(count: number): string {
  return count > 9 ? '9+' : String(count);
}

function matchesQuery(c: ChatConversation, query: string): boolean {
  const titleMatch = conversationTitle(c).toLowerCase().includes(query);
  const bodyMatch = c.lastMessage?.body.toLowerCase().includes(query) ?? false;
  return titleMatch || bodyMatch;
}

function PaneHeader({
  query,
  onQueryChange,
}: {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
}) {
  return (
    <div className="shrink-0 border-b border-outline-variant p-4">
      <h2 className="font-headline-h3 text-headline-h3 text-on-surface mb-4">Messages</h2>
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
          search
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search conversations"
          placeholder="Search conversations…"
          className="w-full pl-10 pr-4 py-2 bg-surface-container rounded-full border-none font-small text-small text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-brand-orange-dark"
        />
      </div>
    </div>
  );
}

function ConversationAvatar({ conversation }: { readonly conversation: ChatConversation }) {
  if (conversation.type === 'GROUP') {
    return (
      <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center overflow-hidden shrink-0">
        <span className="material-symbols-outlined text-xl text-on-primary-container">
          diversity_3
        </span>
      </div>
    );
  }

  const { avatarUrl, displayName } = conversation.otherUser ?? {};
  const initial = displayName?.charAt(0)?.toUpperCase() ?? 'U';

  return (
    <div className="w-12 h-12 rounded-full bg-primary-fixed overflow-hidden border border-primary/20 flex items-center justify-center shrink-0">
      {avatarUrl ? (
        <img className="w-full h-full object-cover" src={avatarUrl} alt={displayName ?? 'User'} />
      ) : (
        <span className="text-base font-bold text-on-primary-container">{initial}</span>
      )}
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
}: {
  readonly conversation: ChatConversation;
  readonly active: boolean;
}) {
  const base = 'flex items-center gap-3 p-4 border-l-4 transition-colors';
  const stateClass = active
    ? 'bg-surface-container border-brand-orange-dark'
    : 'border-transparent hover:bg-surface-container-highest';

  return (
    <Link href={`/chat/${conversation.id}`} className={`${base} ${stateClass}`}>
      <ConversationAvatar conversation={conversation} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="font-body text-body font-semibold truncate text-on-surface">
            {conversationTitle(conversation)}
          </h3>
          {conversation.lastMessage && (
            <span className="font-micro text-micro text-on-surface-variant shrink-0">
              {relativeTime(conversation.lastMessage.createdAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="font-small text-small text-on-surface-variant truncate flex-1">
            {conversation.lastMessage ? conversation.lastMessage.body : 'Say hello!'}
          </p>
          {conversation.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-brand-orange-dark text-on-primary font-bold text-[10px] shrink-0">
              {unreadLabel(conversation.unreadCount)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CenteredState({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      {children}
    </div>
  );
}

function LoadingState({ skeletonKeys }: { readonly skeletonKeys: string[] }) {
  return (
    <div className="space-y-2 p-4">
      {skeletonKeys.map((key) => (
        <div key={key} className="h-16 bg-surface-container-high rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <CenteredState>
      <span className="material-symbols-outlined text-[64px] text-error opacity-40 mb-4">error</span>
      <h3 className="font-headline-h3 text-headline-h3 text-on-surface mb-2">
        Couldn&apos;t load conversations.
      </h3>
      <p className="font-body text-on-surface-variant max-w-xs mb-4">
        Check your connection and try again.
      </p>
      <button
        onClick={onRetry}
        className="font-display font-headline-h4 px-6 h-11 rounded-md bg-brand-orange-dark text-on-primary flex items-center gap-2 shadow-sm hover:brightness-110 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">refresh</span> Retry
      </button>
    </CenteredState>
  );
}

function EmptyState() {
  return (
    <CenteredState>
      <span className="material-symbols-outlined text-[64px] text-primary opacity-40 mb-4">forum</span>
      <h3 className="font-headline-h3 text-headline-h3 text-on-surface mb-2">No conversations yet</h3>
      <p className="font-body text-on-surface-variant max-w-xs mb-4">
        Message a friend from their profile to start chatting.
      </p>
      <Link
        href="/friends"
        className="font-display font-headline-h4 px-6 h-11 rounded-md bg-brand-orange-dark text-on-primary flex items-center gap-2 shadow-sm hover:brightness-110 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">group</span> Find friends
      </Link>
    </CenteredState>
  );
}

function NoResultsState() {
  return (
    <p className="px-4 py-8 text-center font-small text-small text-on-surface-variant">
      No conversations match
    </p>
  );
}

export function ConversationList() {
  const { isReady } = useRequireAuth();
  const pathname = usePathname();
  const { addToast } = useToast();
  const conversations = useChatStore((s) => s.conversations);
  const setConversations = useChatStore((s) => s.setConversations);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  const loadConversations = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchConversations()
      .then((result) => {
        setConversations(result);
      })
      .catch(() => {
        setError(true);
        addToast('Failed to load conversations.', 'error');
      })
      .finally(() => setLoading(false));
  }, [setConversations, addToast]);

  useEffect(() => {
    if (!isReady) return;
    loadConversations();
  }, [isReady, loadConversations]);

  const skeletonKeys = useMemo(
    () => Array.from({ length: 4 }, () => crypto.randomUUID()),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => matchesQuery(c, q));
  }, [conversations, query]);

  const showLoading = !isReady || loading;
  const showError = !showLoading && error && conversations.length === 0;
  const showEmpty = !showLoading && !showError && conversations.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader query={query} onQueryChange={setQuery} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {showLoading && <LoadingState skeletonKeys={skeletonKeys} />}
        {showError && <ErrorState onRetry={loadConversations} />}
        {showEmpty && <EmptyState />}
        {!showLoading && !showError && !showEmpty && filtered.length === 0 && <NoResultsState />}
        {!showLoading && !showError && !showEmpty && filtered.length > 0 && (
          <Stagger as="ul" ariaLabel="Conversations">
            {filtered.map((c) => (
              <StaggerItem as="li" key={c.id}>
                <ConversationRow conversation={c} active={pathname === `/chat/${c.id}`} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </div>
  );
}
