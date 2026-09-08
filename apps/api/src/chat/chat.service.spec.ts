import { Test } from '@nestjs/testing';
import { ChatService } from './chat.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PubSubService } from './pubsub.service.js';

describe('ChatService authorization', () => {
  let service: ChatService;
  let prisma: {
    conversationMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
    };
    message: { create: jest.Mock; findMany: jest.Mock };
    conversation: {
      update: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    groupMember: { findFirst: jest.Mock; findMany: jest.Mock };
    friendship: { findFirst: jest.Mock };
    user: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  const userA = 'user-a';
  const userB = 'user-b';

  const directConversation = { id: 'c1', type: 'DIRECT', groupId: null };
  const groupConversation = { id: 'gc1', type: 'GROUP', groupId: 'g1' };

  beforeEach(async () => {
    prisma = {
      conversationMember: {
        findUnique: jest.fn().mockResolvedValue({ userId: userA, lastReadAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      message: {
        create: jest.fn().mockResolvedValue({ id: 'm1', body: 'hi' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      conversation: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(directConversation),
        create: jest.fn().mockResolvedValue({ id: 'c1', type: 'DIRECT' }),
      },
      groupMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      friendship: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
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
    await expect(service.getMessages('c1', userA, undefined, 25)).rejects.toThrow(
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

  it('rejects access to a missing conversation', async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    await expect(service.getMessages('nope', userA, undefined, 25)).rejects.toThrow(
      "You don't have access to this conversation",
    );
    expect(prisma.conversationMember.findUnique).not.toHaveBeenCalled();
  });

  it('rejects getOrCreateGroupConversation for a non-active group member', async () => {
    await expect(service.getOrCreateGroupConversation('g1', userA)).rejects.toThrow(
      'You must be an active member of this group',
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });

  // ── Group conversations (H9: authorize via GroupMember + self-heal mirror) ──

  it('authorizes an active group member and upserts the mirror on access', async () => {
    prisma.conversation.findUnique.mockResolvedValue(groupConversation);
    prisma.groupMember.findFirst.mockResolvedValue({
      id: 'gm1',
      groupId: 'g1',
      userId: userA,
      status: 'ACTIVE',
    });
    // Conversation member mirror does not exist yet — assertMember must not consult it.
    prisma.conversationMember.findUnique.mockResolvedValue(null);

    // sendMessage requires assertMember to pass for the GROUP conversation. Use a
    // whitespace body so we only reach the empty-body check after authorization.
    await expect(
      service.sendMessage({ conversationId: 'gc1', body: '   ' }, userA),
    ).rejects.toThrow('Message body cannot be empty');

    expect(prisma.conversationMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.groupMember.findFirst).toHaveBeenCalledWith({
      where: { groupId: 'g1', userId: userA, status: 'ACTIVE' },
    });
    expect(prisma.conversationMember.upsert).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: 'gc1', userId: userA } },
      update: {},
      create: { conversationId: 'gc1', userId: userA },
    });
  });

  it('rejects a group conversation when caller is not an active group member', async () => {
    prisma.conversation.findUnique.mockResolvedValue(groupConversation);
    prisma.groupMember.findFirst.mockResolvedValue(null);
    await expect(service.markRead('gc1', userA)).rejects.toThrow(
      "You don't have access to this conversation",
    );
    expect(prisma.conversationMember.upsert).not.toHaveBeenCalled();
  });

  it('creates a group conversation with member rows for all active members', async () => {
    prisma.groupMember.findFirst.mockResolvedValue({
      id: 'gm1',
      groupId: 'g1',
      userId: userA,
      status: 'ACTIVE',
    });
    prisma.groupMember.findMany.mockResolvedValue([
      { userId: userA },
      { userId: userB },
    ]);
    prisma.conversation.create.mockResolvedValue({
      id: 'gc1',
      type: 'GROUP',
      groupId: 'g1',
    });

    const conv = await service.getOrCreateGroupConversation('g1', userA);

    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: {
        type: 'GROUP',
        groupId: 'g1',
        members: { create: [{ userId: userA }, { userId: userB }] },
      },
    });
    expect(conv.id).toBe('gc1');
  });

  it('backfills missing member rows when a group conversation already exists', async () => {
    prisma.groupMember.findFirst.mockResolvedValue({
      id: 'gm1',
      groupId: 'g1',
      userId: userA,
      status: 'ACTIVE',
    });
    prisma.groupMember.findMany.mockResolvedValue([
      { userId: userA },
      { userId: userB },
    ]);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'gc1',
      type: 'GROUP',
      groupId: 'g1',
    });

    const conv = await service.getOrCreateGroupConversation('g1', userA);

    expect(conv.id).toBe('gc1');
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.conversationMember.createMany).toHaveBeenCalledWith({
      data: [
        { conversationId: 'gc1', userId: userA },
        { conversationId: 'gc1', userId: userB },
      ],
      skipDuplicates: true,
    });
  });

  it('rejects self-chat', async () => {
    await expect(service.getOrCreateDirectConversation(userA, userA)).rejects.toThrow(
      'You cannot message yourself',
    );
  });

  it('rejects unknown users', async () => {
    prisma.user = { findUnique: jest.fn().mockResolvedValue(null) };
    await expect(service.getOrCreateDirectConversation(userA, 'ghost')).rejects.toThrow(
      'User not found',
    );
  });

  it('rejects blocked pairs', async () => {
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: userB }) };
    prisma.friendship.findFirst.mockResolvedValueOnce({ status: 'BLOCKED' });
    await expect(service.getOrCreateDirectConversation(userA, userB)).rejects.toThrow(
      'You cannot message this user',
    );
  });

  it('rejects non-friends', async () => {
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: userB }) };
    prisma.friendship.findFirst
      .mockResolvedValueOnce(null) // no BLOCKED row
      .mockResolvedValueOnce(null); // no ACCEPTED row
    await expect(service.getOrCreateDirectConversation(userA, userB)).rejects.toThrow(
      'You can only message your friends',
    );
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('creates a conversation for friends', async () => {
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: userB }) };
    prisma.friendship.findFirst
      .mockResolvedValueOnce(null) // no BLOCKED row
      .mockResolvedValueOnce({ status: 'ACCEPTED' }); // accepted friendship
    const conv = await service.getOrCreateDirectConversation(userA, userB);
    expect(conv.id).toBe('c1');
  });

  // ── getMessages pagination (M6: composite cursor with id tie-break) ─────────

  describe('getMessages pagination', () => {
    const mkMsg = (id: string, iso: string) => ({
      id,
      conversationId: 'c1',
      senderId: userA,
      body: id,
      createdAt: new Date(iso),
      sender: { id: userA, displayName: 'A', avatarUrl: null },
    });

    it('passes cursor-derived tie-break filter and clamps limit', async () => {
      prisma.message.findMany.mockResolvedValueOnce([mkMsg('m5', '2024-01-05T00:00:00.000Z')]);

      // Cursor for a message at 2024-01-04T00:00:00.000Z / id 'm4'
      const cursor = Buffer.from('2024-01-04T00:00:00.000Z|m4', 'utf8').toString('base64url');

      const result = await service.getMessages('c1', userA, cursor, 500);

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'c1',
          deletedAt: null,
          OR: [
            { createdAt: { lt: new Date('2024-01-04T00:00:00.000Z') } },
            {
              createdAt: new Date('2024-01-04T00:00:00.000Z'),
              id: { lt: 'm4' },
            },
          ],
        },
        take: 101, // clamped to 100 then +1 for hasNextPage probe
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { sender: true },
      });
      expect(result.edges[0].node.id).toBe('m5');
      expect(result.hasNextPage).toBe(false);
    });

    it('encodes composite cursors and decodes them for the next page', async () => {
      const messages = [
        mkMsg('m3', '2024-01-03T00:00:00.000Z'),
        mkMsg('m2', '2024-01-02T00:00:00.000Z'),
        mkMsg('m1', '2024-01-01T00:00:00.000Z'),
      ];
      prisma.message.findMany.mockResolvedValueOnce(messages.slice(0, 2));

      const page1 = await service.getMessages('c1', userA, undefined, 2);
      expect(page1.edges.length).toBe(2);
      expect(page1.hasNextPage).toBe(false);
      const cursor = page1.edges[1].cursor;
      expect(cursor).not.toBe('2024-01-02T00:00:00.000Z'); // not the raw ISO
      expect(cursor).toBe(
        Buffer.from('2024-01-02T00:00:00.000Z|m2', 'utf8').toString('base64url'),
      );

      // Page 2 uses the composite cursor from page 1.
      prisma.message.findMany.mockResolvedValueOnce([]);
      await service.getMessages('c1', userA, cursor, 2);
      expect(prisma.message.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            conversationId: 'c1',
            deletedAt: null,
            OR: [
              { createdAt: { lt: new Date('2024-01-02T00:00:00.000Z') } },
              {
                createdAt: new Date('2024-01-02T00:00:00.000Z'),
                id: { lt: 'm2' },
              },
            ],
          },
        }),
      );
    });

    it('throws Invalid cursor for malformed cursors', async () => {
      await expect(service.getMessages('c1', userA, 'not-base64!@#$%', 25)).rejects.toThrow(
        'Invalid cursor',
      );
    });

    it('throws Invalid cursor when the date portion is NaN', async () => {
      const cursor = Buffer.from('not-a-date|m1', 'utf8').toString('base64url');
      await expect(service.getMessages('c1', userA, cursor, 25)).rejects.toThrow(
        'Invalid cursor',
      );
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('treats same-timestamp messages as a stable total order via id', async () => {
      prisma.message.findMany.mockResolvedValueOnce([]);
      const cursor = Buffer.from('2024-01-01T00:00:00.000Z|m-bbb', 'utf8').toString('base64url');
      const result = await service.getMessages('c1', userA, cursor, 25);
      expect(result.edges).toEqual([]);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId: 'c1',
            deletedAt: null,
            OR: [
              { createdAt: { lt: new Date('2024-01-01T00:00:00.000Z') } },
              {
                createdAt: new Date('2024-01-01T00:00:00.000Z'),
                id: { lt: 'm-bbb' },
              },
            ],
          },
        }),
      );
    });
  });

  // ── listConversations limit (default 50, clamp 1..200) ─────────────────────

  describe('listConversations limit', () => {
    it('defaults to a take of 50 when no limit is passed', async () => {
      prisma.conversation.findMany.mockResolvedValueOnce([]);
      await service.listConversations(userA);
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('threads an explicit limit into take', async () => {
      prisma.conversation.findMany.mockResolvedValueOnce([]);
      await service.listConversations(userA, 120);
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 120 }),
      );
    });

    it('clamps limits above 200 to 200', async () => {
      prisma.conversation.findMany.mockResolvedValueOnce([]);
      await service.listConversations(userA, 500);
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('clamps limits below 1 to 1', async () => {
      prisma.conversation.findMany.mockResolvedValueOnce([]);
      await service.listConversations(userA, 0);
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });
});
