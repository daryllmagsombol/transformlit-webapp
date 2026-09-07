/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { ChatResolver } from './chat.resolver';
import { ChatService } from './chat.service';
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

const mockUser = { id: 'user-1' };

describe('ChatResolver', () => {
  let resolver: ChatResolver;
  let chatService: Record<string, jest.Mock>;
  let pubSub: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockChatService = {
      listConversations: jest.fn().mockResolvedValue([mockConversation]),
      getMessages: jest.fn().mockResolvedValue({
        edges: [{ node: mockMessage, cursor: '2024-01-01T12:00:00.000Z' }],
        totalCount: 1,
        hasNextPage: false,
      }),
      getOrCreateDirectConversation: jest.fn().mockResolvedValue(mockConversation),
      sendMessage: jest.fn().mockResolvedValue(mockMessage),
      markRead: jest.fn().mockResolvedValue(true),
    };

    const mockPubSub = {
      asyncIterator: jest.fn().mockReturnValue({
        next: jest.fn(),
        return: jest.fn(),
        throw: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatResolver,
        { provide: ChatService, useValue: mockChatService },
        { provide: PubSubService, useValue: mockPubSub },
      ],
    }).compile();

    resolver = module.get<ChatResolver>(ChatResolver);
    chatService = module.get(ChatService) as any;
    pubSub = module.get(PubSubService) as any;
    jest.clearAllMocks();
  });

  // ── conversations query ─────────────────────────────────────────────────────

  describe('conversations', () => {
    it('should delegate to listConversations with user id and default limit', async () => {
      const result = await resolver.conversations(mockUser);
      expect(chatService.listConversations).toHaveBeenCalledWith('user-1', undefined);
      expect(result).toEqual([mockConversation]);
    });

    it('should forward an explicit limit', async () => {
      const result = await resolver.conversations(mockUser, 120);
      expect(chatService.listConversations).toHaveBeenCalledWith('user-1', 120);
      expect(result).toEqual([mockConversation]);
    });
  });

  // ── messages query ──────────────────────────────────────────────────────────

  describe('messages', () => {
    it('should delegate to getMessages with conversationId', async () => {
      const result = await resolver.messages(mockUser, 'conv-1');
      expect(chatService.getMessages).toHaveBeenCalledWith('conv-1', undefined, undefined, 'user-1');
      expect(result).toEqual({
        edges: [{ node: mockMessage, cursor: '2024-01-01T12:00:00.000Z' }],
        totalCount: 1,
        hasNextPage: false,
      });
    });

    it('should pass cursor and limit when provided', async () => {
      const result = await resolver.messages(mockUser, 'conv-1', '2024-01-01T00:00:00.000Z', 10);
      expect(chatService.getMessages).toHaveBeenCalledWith('conv-1', '2024-01-01T00:00:00.000Z', 10, 'user-1');
      expect(result).toBeDefined();
    });
  });

  // ── startDirectConversation mutation ────────────────────────────────────────

  describe('startDirectConversation', () => {
    it('should delegate to getOrCreateDirectConversation with user id and otherUserId', async () => {
      const result = await resolver.startDirectConversation(mockUser, 'user-2');
      expect(chatService.getOrCreateDirectConversation).toHaveBeenCalledWith('user-1', 'user-2');
      expect(result).toEqual(mockConversation);
    });
  });

  // ── sendMessage mutation ────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('should delegate to sendMessage with input and user id', async () => {
      const input = { conversationId: 'conv-1', body: 'Hello' };
      const result = await resolver.sendMessage(mockUser, input);
      expect(chatService.sendMessage).toHaveBeenCalledWith(input, 'user-1');
      expect(result).toEqual(mockMessage);
    });
  });

  // ── markConversationRead mutation ──────────────────────────────────────────

  describe('markConversationRead', () => {
    it('should delegate to markRead with conversationId and user id', async () => {
      const result = await resolver.markConversationRead(mockUser, 'conv-1');
      expect(chatService.markRead).toHaveBeenCalledWith('conv-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  // ── messageAdded subscription ──────────────────────────────────────────────

  describe('messageAdded', () => {
    it('should return asyncIterator from pubSub for messageAdded channel', () => {
      const iterator = resolver.messageAdded('conv-1');
      expect(pubSub.asyncIterator).toHaveBeenCalledWith('messageAdded');
      expect(iterator).toBeDefined();
      expect(iterator.next).toBeDefined();
    });
  });
});
