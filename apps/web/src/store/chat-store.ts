import { create } from 'zustand';
import type { ChatConversation, ChatMessage } from '../lib/chat-queries';

interface ChatStore {
  conversations: ChatConversation[];
  totalUnread: number;
  viewingConversationId: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  hasMoreByConversation: Record<string, boolean>;
  cursorByConversation: Record<string, string | undefined>;
  setConversations: (conversations: ChatConversation[]) => void;
  upsertConversation: (conversation: ChatConversation) => void;
  setViewingConversationId: (id: string | null) => void;
  setMessages: (conversationId: string, messages: ChatMessage[], hasMore: boolean, cursor?: string) => void;
  prependMessages: (conversationId: string, messages: ChatMessage[], hasMore: boolean, cursor?: string) => void;
  appendMessage: (message: ChatMessage, currentUserId?: string) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  clearUnread: (conversationId: string) => void;
  reset: () => void;
}

function sumUnread(conversations: ChatConversation[]): number {
  return conversations.reduce((sum, c) => sum + c.unreadCount, 0);
}

function sortByUpdatedAt(conversations: ChatConversation[]): ChatConversation[] {
  return [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export const useChatStore = create<ChatStore>((set) => ({
  conversations: [],
  totalUnread: 0,
  viewingConversationId: null,
  messagesByConversation: {},
  hasMoreByConversation: {},
  cursorByConversation: {},

  setConversations: (conversations) =>
    set((state) => {
      const sorted = sortByUpdatedAt(conversations);
      return { ...state, conversations: sorted, totalUnread: sumUnread(sorted) };
    }),

  upsertConversation: (conversation) =>
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      const conversations = exists
        ? state.conversations.map((c) => (c.id === conversation.id ? conversation : c))
        : [...state.conversations, conversation];
      const sorted = sortByUpdatedAt(conversations);
      return { ...state, conversations: sorted, totalUnread: sumUnread(sorted) };
    }),

  setViewingConversationId: (id) => set({ viewingConversationId: id }),

  setMessages: (conversationId, messages, hasMore, cursor) =>
    set((state) => ({
      ...state,
      messagesByConversation: { ...state.messagesByConversation, [conversationId]: messages },
      hasMoreByConversation: { ...state.hasMoreByConversation, [conversationId]: hasMore },
      cursorByConversation: { ...state.cursorByConversation, [conversationId]: cursor },
    })),

  prependMessages: (conversationId, messages, hasMore, cursor) =>
    set((state) => {
      const existing = state.messagesByConversation[conversationId] ?? [];
      const ids = new Set(existing.map((m) => m.id));
      const merged = [...messages.filter((m) => !ids.has(m.id)), ...existing];
      return {
        ...state,
        messagesByConversation: { ...state.messagesByConversation, [conversationId]: merged },
        hasMoreByConversation: { ...state.hasMoreByConversation, [conversationId]: hasMore },
        cursorByConversation: { ...state.cursorByConversation, [conversationId]: cursor },
      };
    }),

  appendMessage: (message, currentUserId) =>
    set((state) => {
      const list = state.messagesByConversation[message.conversationId] ?? [];
      if (list.some((m) => m.id === message.id)) return state;

      const messagesByConversation = {
        ...state.messagesByConversation,
        [message.conversationId]: [...list, message],
      };

      const conversation = state.conversations.find((c) => c.id === message.conversationId);
      if (!conversation) return { ...state, messagesByConversation };

      const viewing = state.viewingConversationId === message.conversationId;
      const updated: ChatConversation = {
        ...conversation,
        updatedAt: message.createdAt,
        lastMessage: { id: message.id, body: message.body, senderId: message.senderId, createdAt: message.createdAt },
        unreadCount:
          viewing || message.senderId === currentUserId
            ? conversation.unreadCount
            : conversation.unreadCount + 1,
      };
      const conversations = sortByUpdatedAt(
        state.conversations.map((c) => (c.id === updated.id ? updated : c)),
      );
      return {
        ...state,
        messagesByConversation,
        conversations,
        totalUnread: sumUnread(conversations),
      };
    }),

  removeMessage: (conversationId, messageId) =>
    set((state) => ({
      ...state,
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).filter(
          (m) => m.id !== messageId,
        ),
      },
    })),

  clearUnread: (conversationId) =>
    set((state) => {
      const conversations = state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      );
      return { ...state, conversations, totalUnread: sumUnread(conversations) };
    }),

  reset: () =>
    set({
      conversations: [],
      totalUnread: 0,
      viewingConversationId: null,
      messagesByConversation: {},
      hasMoreByConversation: {},
      cursorByConversation: {},
    }),
}));