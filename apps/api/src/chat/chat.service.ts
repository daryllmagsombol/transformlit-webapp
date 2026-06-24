import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PubSubService } from './pubsub.service.js';
import { SendMessageInput } from '@transformlit/shared';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
  ) {}

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { members: { some: { userId } }, deletedAt: null },
      include: {
        members: { include: { user: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getOrCreateDirectConversation(userId: string, otherUserId: string) {
    // Find existing direct conversation
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        deletedAt: null,
        AND: [
          { members: { some: { userId } } },
          { members: { some: { userId: otherUserId } } },
        ],
      },
    });
    if (existing) return existing;

    // Create new
    const conv = await this.prisma.conversation.create({
      data: {
        type: 'DIRECT',
        members: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
    });
    return conv;
  }

  async getOrCreateGroupConversation(groupId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { type: 'GROUP', groupId, deletedAt: null },
    });
    if (existing) return existing;

    const conv = await this.prisma.conversation.create({
      data: { type: 'GROUP', groupId },
    });
    return conv;
  }

  async sendMessage(input: SendMessageInput, senderId: string) {
    const msg = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId,
        body: input.body,
      },
    });

    // Update conversation timestamp
    await this.prisma.conversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    });

    // Publish via Postgres NOTIFY
    await this.pubSub.publish('message_added', {
      messageAdded: msg,
    });

    return msg;
  }

  async getMessages(
    conversationId: string,
    cursor?: string,
    limit = 25,
  ) {
    const where: any = { conversationId, deletedAt: null };
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const messages = await this.prisma.message.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
    });

    const hasNextPage = messages.length > limit;
    const items = hasNextPage ? messages.slice(0, limit) : messages;

    return {
      edges: items.map((m) => ({
        node: m,
        cursor: m.createdAt.toISOString(),
      })),
      totalCount: 0, // lazy
      hasNextPage,
    };
  }

  async markRead(conversationId: string, userId: string) {
    await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
    return true;
  }
}
