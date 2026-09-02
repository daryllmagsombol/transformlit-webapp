import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { ChatService } from '../src/chat/chat.service';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';

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

describe('Chat GraphQL boundary', () => {
  let app: INestApplication;
  let chatService: ChatService;
  let authService: AuthService;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;
  let user1Token: string;
  let user1Id: string;
  let user2Id: string;
  let user3Id: string;
  let user3Token: string;

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
    await prisma.friendship.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();

    const u1 = await authService.registerLocal({ email: 'u1@example.com', password: 'password123', displayName: 'U1' });
    const u2 = await authService.registerLocal({ email: 'u2@example.com', password: 'password123', displayName: 'U2' });
    const u3 = await authService.registerLocal({ email: 'u3@example.com', password: 'password123', displayName: 'U3' });
    user1Token = u1.accessToken;
    user1Id = u1.user.id;
    user2Id = u2.user.id;
    user3Id = u3.user.id;
    user3Token = u3.accessToken;

    await prisma.friendship.create({ data: { requesterId: user1Id, addresseeId: user2Id, status: 'ACCEPTED' } });
  });

  const gql = (query: string, variables: Record<string, unknown> = {}, token = user1Token) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables });

  it('rejects a non-member reading a conversation', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    const res = await gql(
      `query M($conversationId: String!) { messages(conversationId: $conversationId, limit: 10) { edges { node { id } } hasNextPage } }`,
      { conversationId: conv.id },
      user3Token,
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain("You don't have access to this conversation");
  });

  it('rejects a non-member sending a message', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    const res = await gql(
      `mutation S($input: SendMessageInput!) { sendMessage(input: $input) { id } }`,
      { input: { conversationId: conv.id, body: 'hello' } },
      user3Token,
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain("You don't have access to this conversation");
  });

  it('rejects a non-friend starting a DM', async () => {
    const res = await gql(
      `mutation D($otherUserId: String!) { startDirectConversation(otherUserId: $otherUserId) { id } }`,
      { otherUserId: user3Id },
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain('You can only message your friends');
  });

  it('rejects self-chat', async () => {
    const res = await gql(
      `mutation D($otherUserId: String!) { startDirectConversation(otherUserId: $otherUserId) { id } }`,
      { otherUserId: user1Id },
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain('You cannot message yourself');
  });

  it('rejects over-long message bodies', async () => {
    const conv = await chatService.getOrCreateDirectConversation(user1Id, user2Id);
    const res = await gql(
      `mutation S($input: SendMessageInput!) { sendMessage(input: $input) { id } }`,
      { input: { conversationId: conv.id, body: 'x'.repeat(2001) } },
    );
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain('Message is too long (max 2000 characters)');
  });

  it('allows a friend to start a DM', async () => {
    const res = await gql(
      `mutation D($otherUserId: String!) { startDirectConversation(otherUserId: $otherUserId) { id } }`,
      { otherUserId: user2Id },
    );
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.startDirectConversation.id).toBeTruthy();
  });
});
