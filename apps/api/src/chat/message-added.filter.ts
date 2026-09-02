import { Message } from './models/chat.model.js';

export interface MessageAddedPayload {
  messageAdded: Message;
  memberIds: string[];
}

export interface MessageAddedContext {
  req?: { user?: { id?: string } };
}

export function messageAddedFilter(
  payload: MessageAddedPayload,
  variables: { conversationId?: string },
  context: MessageAddedContext,
): boolean {
  const userId = context?.req?.user?.id;
  if (!userId) return false;
  if (!payload.memberIds.includes(userId)) return false;
  if (variables.conversationId && payload.messageAdded.conversationId !== variables.conversationId) {
    return false;
  }
  return true;
}