import { gql } from '@apollo/client';
import { apolloClient } from './apollo-client';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface ChatConversationGroup {
  id: string;
  name: string;
  slug: string;
  coverImageUrl?: string | null;
}

export interface ChatConversation {
  id: string;
  type: 'DIRECT' | 'GROUP';
  updatedAt: string;
  otherUser?: { id: string; displayName: string; avatarUrl?: string | null } | null;
  group?: ChatConversationGroup | null;
  lastMessage?: Pick<ChatMessage, 'id' | 'body' | 'senderId' | 'createdAt'> | null;
  unreadCount: number;
  myLastReadAt?: string | null;
}

export const CONVERSATIONS_QUERY = gql`
  query Conversations {
    conversations {
      id
      type
      updatedAt
      otherUser { id displayName avatarUrl }
      group { id name slug coverImageUrl }
      lastMessage { id body senderId createdAt }
      unreadCount
      myLastReadAt
    }
  }
`;

export const MESSAGES_QUERY = gql`
  query Messages($conversationId: String!, $cursor: String, $limit: Int!) {
    messages(conversationId: $conversationId, cursor: $cursor, limit: $limit) {
      edges { node { id conversationId senderId body createdAt } cursor }
      hasNextPage
    }
  }
`;

export const SEND_MESSAGE = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) {
      id conversationId senderId body createdAt
    }
  }
`;

export const MARK_CONVERSATION_READ = gql`
  mutation MarkConversationRead($conversationId: String!) {
    markConversationRead(conversationId: $conversationId)
  }
`;

export const START_DIRECT_CONVERSATION = gql`
  mutation StartDirectConversation($otherUserId: String!) {
    startDirectConversation(otherUserId: $otherUserId) { id }
  }
`;

export const MESSAGE_ADDED = gql`
  subscription MessageAdded {
    messageAdded {
      id conversationId senderId body createdAt
    }
  }
`;

export async function fetchConversations(): Promise<ChatConversation[]> {
  const { data } = await apolloClient.query<{ conversations: ChatConversation[] }>({
    query: CONVERSATIONS_QUERY,
  });
  return data?.conversations ?? [];
}

export async function fetchMessages(
  conversationId: string,
  cursor?: string,
  limit = 25,
): Promise<{ messages: ChatMessage[]; hasMore: boolean; cursor?: string }> {
  const { data } = await apolloClient.query<{
    messages: { edges: Array<{ node: ChatMessage; cursor: string }>; hasNextPage: boolean };
  }>({
    query: MESSAGES_QUERY,
    variables: { conversationId, cursor, limit },
  });
  const conn = data?.messages;
  const edges = conn?.edges ?? [];
  const messages = edges.map((e) => e.node).reverse();
  return {
    messages, // ascending chronological order (oldest first) for the thread
    hasMore: conn?.hasNextPage ?? false,
    cursor: edges.at(-1)?.cursor, // oldest edge pre-reversal = next older-page cursor
  };
}

export async function sendChatMessage(conversationId: string, body: string): Promise<ChatMessage> {
  const { data } = await apolloClient.mutate<{ sendMessage: ChatMessage }>({
    mutation: SEND_MESSAGE,
    variables: { input: { conversationId, body } },
  });
  if (!data?.sendMessage) throw new Error('sendMessage returned no message');
  return data.sendMessage;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await apolloClient.mutate({
    mutation: MARK_CONVERSATION_READ,
    variables: { conversationId },
  });
}

export async function startDirectConversation(otherUserId: string): Promise<string> {
  const { data } = await apolloClient.mutate<{ startDirectConversation: { id: string } }>({
    mutation: START_DIRECT_CONVERSATION,
    variables: { otherUserId },
  });
  if (!data?.startDirectConversation) throw new Error('startDirectConversation returned no conversation');
  return data.startDirectConversation.id;
}