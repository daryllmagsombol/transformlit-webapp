'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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

const MAX_COMPOSER_HEIGHT = 120;

function MessageBubble({
  mine,
  body,
  createdAt,
}: {
  readonly mine: boolean;
  readonly body: string;
  readonly createdAt: string;
}) {
  const bubbleClass = mine
    ? 'bg-primary-container text-on-primary-container rounded-br-sm'
    : 'bg-surface-bright text-on-surface border border-outline-variant/30 rounded-bl-sm';

  return (
    <div className={`flex flex-col gap-1 w-fit max-w-[75%] ${mine ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
      <div
        className={`px-5 py-3 rounded-2xl shadow-sm font-small text-small whitespace-pre-wrap break-words ${bubbleClass}`}
      >
        {body}
      </div>
      <span className={`font-micro text-micro text-on-surface-variant ${mine ? 'mr-1' : 'ml-1'}`}>
        {relativeTime(createdAt)}
      </span>
    </div>
  );
}

function NewDivider() {
  return (
    <div className="relative flex items-center py-4" aria-hidden="true">
      <div className="flex-grow border-t border-outline-variant opacity-50" />
      <span className="shrink-0 px-4 py-1 bg-paper font-micro text-micro text-brand-orange-dark font-medium rounded-full border border-outline-variant/30 shadow-sm">
        New
      </span>
      <div className="flex-grow border-t border-outline-variant opacity-50" />
    </div>
  );
}

export function ChatThread({ conversationId }: { readonly conversationId: string }) {
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

  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const skeletonKeys = useMemo(
    () => Array.from({ length: 4 }, () => crypto.randomUUID()),
    [],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
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
    setLoading(true);
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
      .catch(() => addToast('Failed to load messages.', 'error'))
      .finally(() => {
        if (active) setLoading(false);
      });

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

  // Auto-grow the composer up to a capped height (mirrors the reference script).
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [draft]);

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
    useChatStore.getState().appendMessage(temp, currentUserId);

    try {
      const saved = await sendChatMessage(conversationId, body);
      useChatStore.getState().removeMessage(conversationId, tempId);
      useChatStore.getState().appendMessage(saved, currentUserId);
      scrollToBottom();
    } catch {
      useChatStore.getState().removeMessage(conversationId, tempId);
      addToast('Failed to send message.', 'error');
    }
  };

  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner fullScreen={false} />
      </div>
    );
  }

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
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-outline-variant bg-surface-bright px-4 md:px-6">
        <button
          onClick={() => router.back()}
          className="md:hidden -ml-1 w-11 h-11 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors shrink-0"
          aria-label="Back"
        >
          <span className="material-symbols-outlined text-on-surface">arrow_back</span>
        </button>
        <UserAvatar
          avatarUrl={otherUser?.avatarUrl}
          displayName={otherUser?.displayName}
          size="md"
        />
        <h1 className="font-body text-headline-h4 font-bold text-on-surface truncate">
          {title ?? 'Chat'}
        </h1>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-6"
      >
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <LoadingSpinner fullScreen={false} showLabel={false} />
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          return (
            <div key={m.id}>
              {i === newStartIndex && <NewDivider />}
              <MessageBubble mine={mine} body={m.body} createdAt={m.createdAt} />
            </div>
          );
        })}
        {messages.length === 0 && loading && (
          <div className="flex flex-col gap-4" aria-hidden="true">
            {skeletonKeys.map((key, index) => (
              <div
                key={key}
                className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}
              >
                <div className="h-12 w-48 max-w-[75%] rounded-2xl bg-surface-container-high animate-pulse" />
              </div>
            ))}
          </div>
        )}
        {messages.length === 0 && !loading && (
          <div className="flex-1 flex items-center justify-center py-16 text-center">
            <p className="font-body text-on-surface-variant">
              No messages yet — say hello!
            </p>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-outline-variant bg-surface-bright p-4">
        <div className="flex items-end gap-2 max-w-4xl mx-auto bg-surface-container-lowest rounded-2xl border border-outline-variant p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary-container transition-all">
          <button
            type="button"
            disabled
            aria-label="Attachments unavailable"
            className="p-2 mb-1 shrink-0 rounded-full text-on-surface-variant opacity-40 cursor-not-allowed"
          >
            <span className="material-symbols-outlined">add_circle</span>
          </button>
          <textarea
            ref={composerRef}
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
            className="flex-1 resize-none bg-transparent border-none focus:ring-0 focus:outline-none font-small text-small text-on-surface placeholder:text-on-surface-variant py-3 min-h-[44px] max-h-[120px]"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!draft.trim()}
            className="w-11 h-11 min-h-11 min-w-11 mb-1 flex items-center justify-center rounded-full bg-primary-container text-on-primary-container hover:bg-brand-orange-dark disabled:opacity-40 active:scale-95 transition-all shrink-0"
            aria-label="Send message"
          >
            <span className="material-symbols-outlined filled text-[20px]">send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
