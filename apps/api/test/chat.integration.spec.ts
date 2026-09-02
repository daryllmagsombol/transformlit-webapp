import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { ChatService } from '../src/chat/chat.service';
import { PubSubService } from '../src/chat/pubsub.service';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function runMigrations(pool: Pool) {
  await pool.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
  const dirs = fs.readdirSync(migrationsDir).sort();
  for (const dir of dirs) {
    const sqlFile = path.join(migrationsDir, dir, 'migration.sql');
    if (fs.existsSync(sqlFile)) {
      const sql = fs.readFileSync(sqlFile, 'utf-8');
      await pool.query(sql);
    }
  }
}

describe('Chat Integration', () => {
  let app: INestApplication;
  let chatService: ChatService;
  let authService: AuthService;
  let prisma: PrismaService;
  let pubSub: PubSubService;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;
  let user1Id: string;
  let user2Id: string;

  async function makeFriends(a: string, b: string) {
    await prisma.friendship.create({
      data: { requesterId: a, addresseeId: b, status: 'ACCEPTED' },
    });
  }

  beforeAll(async () => {
    let databaseUrl: string;

    if (isDockerAvailable()) {
      container = await new PostgreSqlContainer('postgres:15-alpine')
        .withDatabase('testdb')
        .withUsername('test')
        .withPassword('test')
        .start();
      databaseUrl = container.getConnectionUri();
    } else {
      databaseUrl =
        process.env.TEST_DATABASE_URL ||
        'postgresql://localhost:5432/transformlit_test';
    }

    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.GOOGLE_CLIENT_ID = 'test';
    process.env.GOOGLE_CLIENT_SECRET = 'test';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3005/auth/google/callback';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    process.env.AZURE_STORAGE_CONTAINER = 'test';
    process.env.AZURE_COMMUNICATION_CONNECTION_STRING = '';
    process.env.AZURE_EMAIL_SENDER = 'test@example.com';

    pool = new Pool({ connectionString: databaseUrl });

    await runMigrations(pool);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    chatService = moduleFixture.get<ChatService>(ChatService);
    authService = moduleFixture.get<AuthService>(AuthService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    pubSub = moduleFixture.get<PubSubService>(PubSubService);
  }, 120000);

  afterAll(async () => {
    const closeTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('close timeout')), 15000),
    );
    try {
      await Promise.race([app?.close(), closeTimeout]);
    } catch {
    }
    await pool?.end();
    if (container) {
      await container.stop();
    }
  }, 30000);

  beforeEach(async () => {
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.friendship.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();

    const user1 = await authService.registerLocal({
      email: 'user1@example.com',
      password: 'password123',
      displayName: 'User One',
    });
    user1Id = user1.user.id;

    const user2 = await authService.registerLocal({
      email: 'user2@example.com',
      password: 'password123',
      displayName: 'User Two',
    });
    user2Id = user2.user.id;

    await makeFriends(user1Id, user2Id);
  });

  describe('getOrCreateDirectConversation', () => {
    it('should create a new direct conversation', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);

      expect(conv).toHaveProperty('id');
      expect(conv.type).toBe('DIRECT');

      const members = await prisma.conversationMember.findMany({
        where: { conversationId: conv.id },
      });
      expect(members.length).toBe(2);
      const memberIds = members.map((m) => m.userId).sort();
      expect(memberIds).toEqual([user1Id, user2Id].sort());
    });

    it('should return existing conversation on second call', async () => {
      const first = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
      const second = await chatService.getOrCreateDirectConversation(user1Id, user2Id);

      expect(second.id).toBe(first.id);

      const convs = await prisma.conversation.findMany({
        where: { type: 'DIRECT' },
      });
      expect(convs.length).toBe(1);
    });
  });

  describe('sendMessage', () => {
    it('should create a message and update conversation timestamp', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);

      const publishSpy = jest.spyOn(pubSub, 'publish');

      const msg = await chatService.sendMessage(
        { conversationId: conv.id, body: 'Hello!' },
        user1Id,
      );

      expect(msg).toHaveProperty('id');
      expect(msg.conversationId).toBe(conv.id);
      expect(msg.senderId).toBe(user1Id);
      expect(msg.body).toBe('Hello!');

      const dbMsg = await prisma.message.findUnique({ where: { id: msg.id } });
      expect(dbMsg).toBeTruthy();
      expect(dbMsg!.body).toBe('Hello!');
      expect(dbMsg!.senderId).toBe(user1Id);

      expect(publishSpy).toHaveBeenCalledWith('messageAdded', {
        messageAdded: expect.objectContaining({ id: msg.id }),
        memberIds: expect.arrayContaining([user1Id, user2Id]),
      });

      publishSpy.mockRestore();
    });
  });

  describe('getMessages', () => {
    it('should return messages with cursor-based pagination', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);

      for (let i = 0; i < 5; i++) {
        await chatService.sendMessage(
          { conversationId: conv.id, body: `Message ${i}` },
          user1Id,
        );
      }

      const result = await chatService.getMessages(conv.id, undefined, 3, user1Id);

      expect(result.edges.length).toBe(3);
      expect(result.hasNextPage).toBe(true);
      expect(result.edges[0].node.body).toBe('Message 4');
      expect(result.edges[0]).toHaveProperty('cursor');

      const cursor = result.edges[result.edges.length - 1].cursor;
      const page2 = await chatService.getMessages(conv.id, cursor, 3, user1Id);

      expect(page2.edges.length).toBe(2);
      expect(page2.hasNextPage).toBe(false);
      expect(page2.edges[0].node.body).toBe('Message 1');
    });

    it('should return empty edges for conversation with no messages', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);

      const result = await chatService.getMessages(conv.id, undefined, 25, user1Id);

      expect(result.edges.length).toBe(0);
      expect(result.hasNextPage).toBe(false);
    });
  });

  describe('markRead', () => {
    it('should set lastReadAt on conversation member', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);

      await chatService.sendMessage(
        { conversationId: conv.id, body: 'Unread message' },
        user2Id,
      );

      const before = await prisma.conversationMember.findFirst({
        where: { conversationId: conv.id, userId: user1Id },
      });
      expect(before!.lastReadAt).toBeNull();

      const result = await chatService.markRead(conv.id, user1Id);
      expect(result).toBe(true);

      const after = await prisma.conversationMember.findFirst({
        where: { conversationId: conv.id, userId: user1Id },
      });
      expect(after!.lastReadAt).toBeTruthy();
    });
  });

  describe('friends-only DMs', () => {
    it('rejects starting a conversation with a non-friend', async () => {
      const stranger = await authService.registerLocal({
        email: 'stranger@example.com',
        password: 'password123',
        displayName: 'Stranger',
      });
      await expect(
        chatService.getOrCreateDirectConversation(user1Id, stranger.user.id),
      ).rejects.toThrow('You can only message your friends');
    });

    it('rejects self-chat', async () => {
      await expect(
        chatService.getOrCreateDirectConversation(user1Id, user1Id),
      ).rejects.toThrow('You cannot message yourself');
    });
  });

  describe('listConversations enrichment', () => {
    it('returns otherUser, lastMessage, unreadCount and myLastReadAt', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
      await chatService.sendMessage({ conversationId: conv.id, body: 'Hello' }, user2Id);

      const [list] = await chatService.listConversations(user1Id);

      expect(list.id).toBe(conv.id);
      expect(list.otherUser!.id).toBe(user2Id);
      expect(list.lastMessage!.body).toBe('Hello');
      expect(list.unreadCount).toBe(1);
      expect(list.myLastReadAt).toBeNull();
    });

    it('unreadCount resets after markRead and excludes own messages', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
      await chatService.sendMessage({ conversationId: conv.id, body: 'mine' }, user1Id);
      await chatService.sendMessage({ conversationId: conv.id, body: 'yours' }, user2Id);

      let [list] = await chatService.listConversations(user1Id);
      expect(list.unreadCount).toBe(1); // only user2's message

      await chatService.markRead(conv.id, user1Id);
      [list] = await chatService.listConversations(user1Id);
      expect(list.unreadCount).toBe(0);
    });
  });

  describe('getMessages sender', () => {
    it('includes sender user', async () => {
      const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
      await chatService.sendMessage({ conversationId: conv.id, body: 'hi' }, user1Id);

      const result = await chatService.getMessages(conv.id, undefined, 25, user1Id);
      expect(result.edges[0].node.sender!.id).toBe(user1Id);
    });
  });
});
