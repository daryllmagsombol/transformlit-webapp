'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore } from '../../store/chat-store';
import { useAuthStore } from '../../store';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import {
  fetchMessages,
  sendChatMessage,
  markConversationRead,
  ChatMessage,
} from '../../lib/chat-queries';
import { UserAvatar, useToast, LoadingSpinner } from '../ui';
import { relativeTime } from '../../lib/time';

export function ChatThread({ conversationId }: { conversationId: string }) {
  const { isReady } = useRequireAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const messages = useChatStore((s) => s.messagesByConversation[conversationId]) ?? [];
  const conversation = useChatStore((s) =>
    s.conversations.find((c) => c.id === conversationId),
  );
  const hasMore = useChatStore((s) => s.hasMoreByConversation[conversationId] ?? false);
  const cursor = useChatStore((s) => s.cursorByConversation[conversationId]);

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const initialLoadRef = useRef(false);
  // Snapshot of unread at open — the optimistic clearUnread below would
  // otherwise zero the gate before the "New" divider can render.
  const unreadOnOpenRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;

    if (el.scrollTop < 40 && !loadingOlder && hasMore && cursor) {
      setLoadingOlder(true);
      // Snapshot the height before prepending so we can restore the reading
      // position after older messages push the content down.
      const prevHeight = el.scrollHeight;
      fetchMessages(conversationId, cursor)
        .then(({ messages: older, hasMore: more, cursor: next }) => {
          useChatStore.getState().prependMessages(conversationId, older, more, next);
          requestAnimationFrame(() => {
            const el2 = scrollRef.current;
            if (el2) el2.scrollTop = el2.scrollHeight - prevHeight;
          });
        })
        .catch(() => addToast('Failed to load older messages.', 'error'))
        .finally(() => setLoadingOlder(false));
    }
  }, [conversationId, cursor, hasMore, loadingOlder, addToast]);

  useEffect(() => {
    if (!isReady || !conversationId) return;
    useChatStore.getState().setViewingConversationId(conversationId);

    let active = true;
    fetchMessages(conversationId)
      .then(({ messages, hasMore: more, cursor: next }) => {
        if (!active) return;
        useChatStore.getState().setMessages(conversationId, messages, more, next);
        initialLoadRef.current = true;
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      })
      .catch(() => addToast('Failed to load messages.', 'error'));

    // Mark read on open (optimistic clear + background mutation)
    const openConversation = useChatStore
      .getState()
      .conversations.find((c) => c.id === conversationId);
    unreadOnOpenRef.current = openConversation?.unreadCount ?? 0;
    useChatStore.getState().clearUnread(conversationId);
    markConversationRead(conversationId).catch(() => {
      // non-fatal; next open retries
    });

    return () => {
      active = false;
      useChatStore.getState().setViewingConversationId(null);
    };
  }, [isReady, conversationId, addToast]);

  // When a message arrives while at the bottom, mark read again.
  useEffect(() => {
    if (!initialLoadRef.current) return;
    if (atBottomRef.current) {
      useChatStore.getState().clearUnread(conversationId);
      markConversationRead(conversationId).catch(() => {});
    }
  }, [messages.length, conversationId]);

  useEffect(() => {
    if (initialLoadRef.current && atBottomRef.current) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');

    const tempId = `temp-${crypto.randomUUID()}`;
    const temp: ChatMessage = {
      id: tempId,
      conversationId,
      senderId: currentUserId ?? '',
      body,
      createdAt: new Date().toISOString(),
    };
    useChatStore.getState().appendMessage(temp);

    try {
      const saved = await sendChatMessage(conversationId, body);
      useChatStore.getState().removeMessage(conversationId, tempId);
      useChatStore.getState().appendMessage(saved);
      scrollToBottom();
    } catch {
      useChatStore.getState().removeMessage(conversationId, tempId);
      addToast('Failed to send message.', 'error');
    }
  };

  if (!isReady) return <LoadingSpinner />;

  const otherUser = conversation?.otherUser;
  const title = conversation?.type === 'GROUP' ? conversation.group?.name : otherUser?.displayName;
  const myLastReadAt = conversation?.myLastReadAt
    ? new Date(conversation.myLastReadAt).getTime()
    : null;
  const newStartIndex =
    unreadOnOpenRef.current > 0 && myLastReadAt !== null
      ? messages.findIndex(
          (m) =>
            new Date(m.createdAt).getTime() > myLastReadAt && m.senderId !== currentUserId,
        )
      : -1;

  return (
    <div className="flex flex-col h-[calc(100dvh-13rem)] md:h-[calc(100dvh-11rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-outline-variant mb-3">
        <button
          onClick={() => router.back()}
          className="md:hidden w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
          aria-label="Back"
        >
          <span className="material-symbols-outlined text-on-surface">arrow_back</span>
        </button>
        <UserAvatar
          avatarUrl={otherUser?.avatarUrl}
          displayName={otherUser?.displayName}
          size="md"
        />
        <h1 className="font-display font-headline-h3 text-on-surface truncate">
          {title ?? 'Chat'}
        </h1>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto pr-2 space-y-3"
      >
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <LoadingSpinner />
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          return (
            <div key={m.id}>
              {i === newStartIndex && (
                <div className="flex items-center gap-3 my-3" aria-hidden="true">
                  <div className="flex-1 h-px bg-primary/40" />
                  <span className="font-micro text-[10px] uppercase tracking-widest text-primary font-bold">
                    New
                  </span>
                  <div className="flex-1 h-px bg-primary/40" />
                </div>
              )}
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'} gap-2`}>
                {!mine && (
                  <UserAvatar
                    avatarUrl={otherUser?.avatarUrl}
                    displayName={otherUser?.displayName}
                    size="sm"
                  />
                )}
                <div
                  className={`max-w-[75%] px-4 py-2 rounded-2xl shadow-sm ${
                    mine
                      ? 'bg-brand-orange-dark text-on-primary rounded-br-sm'
                      : 'bg-surface-container-high text-on-surface rounded-bl-sm'
                  }`}
                >
                  <p className="font-body text-body whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={`font-micro text-[10px] mt-1 ${
                      mine ? 'text-on-primary/70' : 'text-on-surface-variant'
                    }`}
                  >
                    {relativeTime(m.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-body text-on-surface-variant">
              No messages yet — say hello!
            </p>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="pt-3 border-t border-outline-variant mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none bg-surface-container-lowest border border-outline-variant rounded-xl px-4 py-3 font-body text-body text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary transition-colors min-h-[48px]"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!draft.trim()}
          className="h-11 w-11 flex items-center justify-center rounded-full bg-brand-orange-dark text-on-primary disabled:opacity-40 hover:brightness-110 active:scale-95 transition-all shrink-0"
          aria-label="Send message"
        >
          <span className="material-symbols-outlined text-[20px]">send</span>
        </button>
      </div>
    </div>
  );
}