import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PubSubService } from './pubsub.service.js';
import { SendMessageInput } from './models/chat.model.js';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
  ) {}

  async listConversations(userId: string, limit = 50) {
    const safeLimit = Math.min(200, Math.max(1, limit));
    const conversations = await this.prisma.conversation.findMany({
      where: { members: { some: { userId } }, deletedAt: null },
      include: {
        members: { include: { user: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
        group: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: safeLimit,
    });

    const unread = await this.getUnreadCounts(userId);

    return conversations.map((conv) => {
      const me = conv.members.find((m) => m.userId === userId);
      const other =
        conv.type === 'DIRECT'
          ? conv.members.find((m) => m.userId !== userId)
          : undefined;
      return {
        id: conv.id,
        type: conv.type,
        groupId: conv.groupId,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        otherUser: other?.user,
        group: conv.group
          ? {
              id: conv.group.id,
              name: conv.group.name,
              slug: conv.group.slug,
              coverImageUrl: conv.group.coverImageUrl ?? undefined,
            }
          : null,
        lastMessage: conv.messages[0] ?? null,
        unreadCount: unread.get(conv.id) ?? 0,
        myLastReadAt: me?.lastReadAt ?? null,
      };
    });
  }

  private async getUnreadCounts(userId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ conversationId: string; count: number }>
    >`
      SELECT cm."conversationId" AS "conversationId", COUNT(m.id)::int AS "count"
      FROM "conversation_members" cm
      LEFT JOIN "messages" m
        ON m."conversationId" = cm."conversationId"
        AND m."deletedAt" IS NULL
        AND m."senderId" <> cm."userId"
        AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
      WHERE cm."userId" = ${userId}
      GROUP BY cm."conversationId"
    `;
    return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
  }

  private async assertMember(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, type: true, groupId: true },
    });
    if (!conversation) {
      throw new Error("You don't have access to this conversation");
    }

    // Direct conversations are authorized purely by the ConversationMember mirror.
    // Group conversations are authoritative via the GroupMember table (a member can
    // exist without a ConversationMember row), so we check GroupMember and lazily
    // self-heal the mirror so listConversations/unread/memberIds work.
    if (conversation.type === 'DIRECT' || !conversation.groupId) {
      const member = await this.prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!member) throw new Error("You don't have access to this conversation");
      return;
    }

    const groupMember = await this.prisma.groupMember.findFirst({
      where: { groupId: conversation.groupId, userId, status: 'ACTIVE' },
    });
    if (!groupMember) {
      throw new Error("You don't have access to this conversation");
    }

    // Self-heal: ensure the user has a ConversationMember mirror row for this
    // group conversation.
    await this.prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      update: {},
      create: { conversationId, userId },
    });
  }

  async getOrCreateDirectConversation(userId: string, otherUserId: string) {
    if (userId === otherUserId) throw new Error('You cannot message yourself');

    const other = await this.prisma.user.findUnique({
      where: { id: otherUserId, deletedAt: null },
    });
    if (!other) throw new Error('User not found');

    const blocked = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
        status: 'BLOCKED',
      },
    });
    if (blocked) throw new Error('You cannot message this user');

    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
        status: 'ACCEPTED',
      },
    });
    if (!friendship) throw new Error('You can only message your friends');

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

  async getOrCreateGroupConversation(groupId: string, userId: string) {
    const caller = await this.prisma.groupMember.findFirst({
      where: { groupId, userId, status: 'ACTIVE' },
    });
    if (!caller) throw new Error('You must be an active member of this group');

    const activeMembers = await this.prisma.groupMember.findMany({
      where: { groupId, status: 'ACTIVE' },
      select: { userId: true },
    });
    const memberIds = activeMembers.map((m) => m.userId);

    const existing = await this.prisma.conversation.findFirst({
      where: { type: 'GROUP', groupId, deletedAt: null },
    });
    if (existing) {
      // Backfill any ConversationMember rows that are missing (e.g. members who
      // joined the group after the conversation was created).
      await this.prisma.conversationMember.createMany({
        data: memberIds.map((id) => ({ conversationId: existing.id, userId: id })),
        skipDuplicates: true,
      });
      return existing;
    }

    const conv = await this.prisma.conversation.create({
      data: {
        type: 'GROUP',
        groupId,
        members: { create: memberIds.map((id) => ({ userId: id })) },
      },
    });
    return conv;
  }

  async sendMessage(input: SendMessageInput, senderId: string) {
    await this.assertMember(input.conversationId, senderId);

    const body = input.body.trim();
    if (!body) throw new Error('Message body cannot be empty');
    if (body.length > 2000) throw new Error('Message is too long (max 2000 characters)');

    const msg = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId,
        body,
      },
      include: { sender: true },
    });

    // Update conversation timestamp
    await this.prisma.conversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    });

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: input.conversationId },
      select: { userId: true },
    });

    // Publish via Postgres NOTIFY; keep the payload slim — exclude the full
    // sender row (password hash, email) from the pg_notify payload.
    const { sender: _sender, ...slim } = msg;
    await this.pubSub.publish('messageAdded', {
      messageAdded: slim,
      memberIds: members.map((m) => m.userId),
    });

    return msg;
  }

  async getMessages(
    conversationId: string,
    userId: string,
    cursor?: string,
    limit = 25,
  ) {
    await this.assertMember(conversationId, userId);

    const safeLimit = Math.min(100, Math.max(1, limit));

    const where: any = { conversationId, deletedAt: null };
    if (cursor) {
      const decoded = this.decodeCursor(cursor);
      where.OR = [
        { createdAt: { lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, id: { lt: decoded.id } },
      ];
    }

    const messages = await this.prisma.message.findMany({
      where,
      take: safeLimit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { sender: true },
    });

    const hasNextPage = messages.length > safeLimit;
    const items = hasNextPage ? messages.slice(0, safeLimit) : messages;

    return {
      edges: items.map((m) => ({
        node: m,
        cursor: this.encodeCursor(m.createdAt, m.id),
      })),
      hasNextPage,
    };
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } {
    let raw: string;
    try {
      raw = Buffer.from(cursor, 'base64url').toString('utf8');
    } catch {
      throw new Error('Invalid cursor');
    }
    const separatorIndex = raw.lastIndexOf('|');
    if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
      throw new Error('Invalid cursor');
    }
    const createdAt = new Date(raw.slice(0, separatorIndex));
    const id = raw.slice(separatorIndex + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) {
      throw new Error('Invalid cursor');
    }
    return { createdAt, id };
  }

  async markRead(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
    return true;
  }
}
