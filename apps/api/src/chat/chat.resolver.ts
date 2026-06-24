import { Resolver, Query, Mutation, Subscription, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { PubSubService } from './pubsub.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { SendMessageInput } from '@transformlit/shared';
import { Conversation, Message, MessageConnection } from './models/chat.model.js';

@Resolver()
export class ChatResolver {
  constructor(
    private readonly chatService: ChatService,
    private readonly pubSub: PubSubService,
  ) {}

  @Query(() => [Conversation], { name: 'conversations' })
  @UseGuards(JwtAuthGuard)
  async conversations(@CurrentUser() user: { id: string }) {
    return this.chatService.listConversations(user.id);
  }

  @Mutation(() => Conversation, { name: 'startDirectConversation' })
  @UseGuards(JwtAuthGuard)
  async startDirectConversation(
    @CurrentUser() user: { id: string },
    @Args('otherUserId') otherUserId: string,
  ) {
    return this.chatService.getOrCreateDirectConversation(user.id, otherUserId);
  }

  @Query(() => MessageConnection, { name: 'messages' })
  @UseGuards(JwtAuthGuard)
  async messages(
    @Args('conversationId') conversationId: string,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('limit', { defaultValue: 25 }) limit?: number,
  ) {
    return this.chatService.getMessages(conversationId, cursor, limit);
  }

  @Mutation(() => Message, { name: 'sendMessage' })
  @UseGuards(JwtAuthGuard)
  async sendMessage(
    @CurrentUser() user: { id: string },
    @Args('input') input: SendMessageInput,
  ) {
    return this.chatService.sendMessage(input, user.id);
  }

  @Mutation(() => Boolean, { name: 'markConversationRead' })
  @UseGuards(JwtAuthGuard)
  async markConversationRead(
    @CurrentUser() user: { id: string },
    @Args('conversationId') conversationId: string,
  ) {
    return this.chatService.markRead(conversationId, user.id);
  }

  @Subscription(() => Message, { name: 'messageAdded' })
  @UseGuards(JwtAuthGuard)
  messageAdded(@Args('conversationId') conversationId: string) {
    return this.pubSub.asyncIterator('messageAdded');
  }
}
