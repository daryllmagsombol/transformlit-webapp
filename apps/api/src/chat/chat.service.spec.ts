/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { PubSubService } from './pubsub.service';

const mockConversation = {
  id: 'conv-1',
  type: 'DIRECT',
  groupId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
};

const mockMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  senderId: 'user-1',
  body: 'Hello',
  createdAt: new Date('2024-01-01T12:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
};

const mockMember = {
  id: 'member-1',
  conversationId: 'conv-1',
  userId: 'user-1',
  lastReadAt: null,
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
};

describe('ChatService', () => {
  let service: ChatService;
  let prisma: any;
  let pubSub: any;

  beforeEach(async () => {
    const mockPrisma = {
      conversation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockConversation),
        update: jest.fn().mockResolvedValue(mockConversation),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(mockMessage),
      },
      conversationMember: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const mockPubSub = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PubSubService, useValue: mockPubSub },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    prisma = module.get(PrismaService);
    pubSub = module.get(PubSubService);
    jest.clearAllMocks();
  });

  // ── listConversations ─────────────────────────────────────────────────────

  describe('listConversations', () => {
    it('should find conversations where user is a member', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      await service.listConversations('user-1');
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { members: { some: { userId: 'user-1' } }, deletedAt: null },
        }),
      );
    });

    it('should include members with user', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      await service.listConversations('user-1');
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            members: { include: { user: true } },
          }),
        }),
      );
    });

    it('should include last message ordered by createdAt desc', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      await service.listConversations('user-1');
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            messages: { take: 1, orderBy: { createdAt: 'desc' } },
          }),
        }),
      );
    });

    it('should order by updatedAt descending', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      await service.listConversations('user-1');
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });

    it('should return conversations from prisma', async () => {
      const convs = [{ ...mockConversation, members: [], messages: [] }];
      prisma.conversation.findMany.mockResolvedValue(convs);
      const result = await service.listConversations('user-1');
      expect(result).toEqual(convs);
    });
  });

  // ── getOrCreateDirectConversation ─────────────────────────────────────────

  describe('getOrCreateDirectConversation', () => {
    it('should find existing DIRECT conversation between two users', async () => {
      prisma.conversation.findFirst.mockResolvedValue(mockConversation);
      const result = await service.getOrCreateDirectConversation('user-1', 'user-2');
      expect(result).toEqual(mockConversation);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('should search for DIRECT type with both users as members', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue(mockConversation);
      await service.getOrCreateDirectConversation('user-1', 'user-2');
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          type: 'DIRECT',
          deletedAt: null,
          AND: [
            { members: { some: { userId: 'user-1' } } },
            { members: { some: { userId: 'user-2' } } },
          ],
        },
      });
    });

    it('should create new DIRECT conversation if none exists', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue(mockConversation);
      await service.getOrCreateDirectConversation('user-1', 'user-2');
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: {
          type: 'DIRECT',
          members: {
            create: [{ userId: 'user-1' }, { userId: 'user-2' }],
          },
        },
      });
    });

    it('should return created conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue(mockConversation);
      const result = await service.getOrCreateDirectConversation('user-1', 'user-2');
      expect(result).toEqual(mockConversation);
    });
  });

  // ── getOrCreateGroupConversation ──────────────────────────────────────────

  describe('getOrCreateGroupConversation', () => {
    it('should find existing GROUP conversation for groupId', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        ...mockConversation,
        type: 'GROUP',
        groupId: 'group-1',
      });
      const result = await service.getOrCreateGroupConversation('group-1');
      expect(result.groupId).toBe('group-1');
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('should search for GROUP type with matching groupId', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue(mockConversation);
      await service.getOrCreateGroupConversation('group-1');
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { type: 'GROUP', groupId: 'group-1', deletedAt: null },
      });
    });

    it('should create new GROUP conversation if none exists', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue({
        ...mockConversation,
        type: 'GROUP',
        groupId: 'group-1',
      });
      await service.getOrCreateGroupConversation('group-1');
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { type: 'GROUP', groupId: 'group-1' },
      });
    });

    it('should return created conversation', async () => {
      const newConv = { ...mockConversation, type: 'GROUP', groupId: 'group-1' };
      prisma.conversation.findFirst.mockResolvedValue(null);
      prisma.conversation.create.mockResolvedValue(newConv);
      const result = await service.getOrCreateGroupConversation('group-1');
      expect(result).toEqual(newConv);
    });
  });

  // ── sendMessage ───────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    const input = { conversationId: 'conv-1', body: 'Hello' };

    it('should create message via prisma', async () => {
      await service.sendMessage(input, 'user-1');
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-1',
          senderId: 'user-1',
          body: 'Hello',
        },
      });
    });

    it('should update conversation updatedAt timestamp', async () => {
      await service.sendMessage(input, 'user-1');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      });
    });

    it('should publish via pubSub with messageAdded channel', async () => {
      await service.sendMessage(input, 'user-1');
      expect(pubSub.publish).toHaveBeenCalledWith('messageAdded', {
        messageAdded: mockMessage,
      });
    });

    it('should return the created message', async () => {
      const result = await service.sendMessage(input, 'user-1');
      expect(result).toEqual(mockMessage);
    });

    it('should call prisma.message.create before conversation.update', async () => {
      const callOrder: string[] = [];
      prisma.message.create.mockImplementation(async () => {
        callOrder.push('message.create');
        return mockMessage;
      });
      prisma.conversation.update.mockImplementation(async () => {
        callOrder.push('conversation.update');
        return mockConversation;
      });
      await service.sendMessage(input, 'user-1');
      expect(callOrder).toEqual(['message.create', 'conversation.update']);
    });
  });

  // ── getMessages ───────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should fetch messages for a conversation without cursor', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      await service.getMessages('conv-1');
      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', deletedAt: null },
        take: 26,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by createdAt < cursor when cursor provided', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      await service.getMessages('conv-1', '2024-06-01T00:00:00.000Z');
      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          deletedAt: null,
          createdAt: { lt: new Date('2024-06-01T00:00:00.000Z') },
        },
        take: 26,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should use custom limit', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      await service.getMessages('conv-1', undefined, 10);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 11 }),
      );
    });

    it('should return hasNextPage false when messages <= limit', async () => {
      const msgs = Array.from({ length: 3 }, (_, i) => ({
        ...mockMessage,
        id: `msg-${i}`,
        createdAt: new Date(`2024-01-0${i + 1}`),
      }));
      prisma.message.findMany.mockResolvedValue(msgs);
      const result = await service.getMessages('conv-1', undefined, 25);
      expect(result.hasNextPage).toBe(false);
    });

    it('should return hasNextPage true when messages > limit', async () => {
      const msgs = Array.from({ length: 26 }, (_, i) => ({
        ...mockMessage,
        id: `msg-${i}`,
        createdAt: new Date('2024-01-01'),
      }));
      prisma.message.findMany.mockResolvedValue(msgs);
      const result = await service.getMessages('conv-1', undefined, 25);
      expect(result.hasNextPage).toBe(true);
    });

    it('should return edges with node and cursor', async () => {
      const msgs = [
        { ...mockMessage, id: 'msg-1', createdAt: new Date('2024-01-01T12:00:00.000Z') },
        { ...mockMessage, id: 'msg-2', createdAt: new Date('2024-01-02T12:00:00.000Z') },
      ];
      prisma.message.findMany.mockResolvedValue(msgs);
      const result = await service.getMessages('conv-1');
      expect(result.edges).toHaveLength(2);
      expect(result.edges[0]).toEqual({
        node: msgs[0],
        cursor: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should return totalCount as 0 (lazy)', async () => {
      prisma.message.findMany.mockResolvedValue([]);
      const result = await service.getMessages('conv-1');
      expect(result.totalCount).toBe(0);
    });

    it('should slice to limit when hasNextPage is true', async () => {
      const msgs = Array.from({ length: 26 }, (_, i) => ({
        ...mockMessage,
        id: `msg-${i}`,
        createdAt: new Date('2024-01-01'),
      }));
      prisma.message.findMany.mockResolvedValue(msgs);
      const result = await service.getMessages('conv-1', undefined, 25);
      expect(result.edges).toHaveLength(25);
    });
  });

  // ── markRead ──────────────────────────────────────────────────────────────

  describe('markRead', () => {
    it('should update conversationMember lastReadAt', async () => {
      await service.markRead('conv-1', 'user-1');
      expect(prisma.conversationMember.updateMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', userId: 'user-1' },
        data: expect.objectContaining({
          lastReadAt: expect.any(Date),
        }),
      });
    });

    it('should return true', async () => {
      const result = await service.markRead('conv-1', 'user-1');
      expect(result).toBe(true);
    });
  });
});
