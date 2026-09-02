'use client';

import { useEffect } from 'react';
import {
  apolloClient,
  registerWsReconnectHandler,
  unregisterWsReconnectHandler,
} from '../../lib/apollo-client';
import { MESSAGE_ADDED, fetchConversations } from '../../lib/chat-queries';
import { useAuthStore } from '../../store';
import { useChatStore } from '../../store/chat-store';

export function ChatProvider() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    const refreshConversations = () => {
      fetchConversations()
        .then((conversations) => {
          if (active) useChatStore.getState().setConversations(conversations);
        })
        .catch(() => {
          // ignore — next mount/event retries
        });
    };

    // Cold start: seed the conversation list (unread badge) immediately.
    refreshConversations();

    // WS drop → graphql-ws auto-reconnect → refetch so messages missed while
    // disconnected (pg NOTIFY gives no replay) and stale badges are refreshed.
    const onWsReconnected = () => refreshConversations();
    registerWsReconnectHandler(onWsReconnected);

    const subscription = apolloClient
      .subscribe<{
        messageAdded: {
          id: string;
          conversationId: string;
          senderId: string;
          body: string;
          createdAt: string;
        };
      }>({ query: MESSAGE_ADDED })
      .subscribe({
      next: ({ data }) => {
        if (!active || !data?.messageAdded) return;
        const message = data.messageAdded as {
          id: string;
          conversationId: string;
          senderId: string;
          body: string;
          createdAt: string;
        };
        const state = useChatStore.getState();
        const known = state.conversations.some((c) => c.id === message.conversationId);
        if (known) {
          state.appendMessage(message);
        } else {
          // New conversation (e.g. started by the other side) — refresh the list.
          refreshConversations();
        }
      },
    });

    return () => {
      active = false;
      unregisterWsReconnectHandler(onWsReconnected);
      subscription.unsubscribe();
      // Logout/account switch tears the subscription down: drop the previous
      // user's conversations/messages/unread. The next authenticated mount
      // cold-starts from scratch, so always-reset is safe.
      useChatStore.getState().reset();
    };
  }, [userId]);

  return null;
}