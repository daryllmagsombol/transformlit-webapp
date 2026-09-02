import { Test } from '@nestjs/testing';
import { ChatService } from './chat.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PubSubService } from './pubsub.service.js';

describe('ChatService authorization', () => {
  let service: ChatService;
  let prisma: {
    conversationMember: { findUnique: jest.Mock };
    message: { create: jest.Mock; findMany: jest.Mock };
    conversation: { update: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    groupMember: { findFirst: jest.Mock };
  };
  const userA = 'user-a';
  const userB = 'user-b';

  beforeEach(async () => {
    prisma = {
      conversationMember: {
        findUnique: jest.fn().mockResolvedValue({ userId: userA, lastReadAt: null }),
      },
      message: {
        create: jest.fn().mockResolvedValue({ id: 'm1', body: 'hi' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      conversation: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'c1', type: 'DIRECT' }),
      },
      groupMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: PubSubService, useValue: { publish: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
  });

  it('rejects getMessages for a non-member', async () => {
    prisma.conversationMember.findUnique.mockResolvedValueOnce(null);
    await expect(service.getMessages('c1', undefined, 25, userA)).rejects.toThrow(
      "You don't have access to this conversation",
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('rejects sendMessage for a non-member', async () => {
    prisma.conversationMember.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.sendMessage({ conversationId: 'c1', body: 'hi' }, userA),
    ).rejects.toThrow("You don't have access to this conversation");
  });

  it('rejects empty and over-long message bodies', async () => {
    await expect(
      service.sendMessage({ conversationId: 'c1', body: '   ' }, userA),
    ).rejects.toThrow('Message body cannot be empty');

    await expect(
      service.sendMessage({ conversationId: 'c1', body: 'x'.repeat(2001) }, userA),
    ).rejects.toThrow('Message is too long (max 2000 characters)');
  });

  it('rejects markRead for a non-member', async () => {
    prisma.conversationMember.findUnique.mockResolvedValueOnce(null);
    await expect(service.markRead('c1', userA)).rejects.toThrow(
      "You don't have access to this conversation",
    );
  });

  it('rejects getOrCreateGroupConversation for a non-active group member', async () => {
    await expect(service.getOrCreateGroupConversation('g1', userA)).rejects.toThrow(
      'You must be an active member of this group',
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});