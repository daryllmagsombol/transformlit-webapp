import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { FriendsService } from '../src/friends/friends.service';
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

describe('Friends Integration', () => {
  let app: INestApplication;
  let friendsService: FriendsService;
  let authService: AuthService;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;
  let requesterId: string;
  let addresseeId: string;

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

    friendsService = moduleFixture.get<FriendsService>(FriendsService);
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
      // ignore close errors or timeout
    }
    await pool?.end();
    if (container) {
      await container.stop();
    }
  }, 30000);

  beforeEach(async () => {
    await prisma.friendship.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();

    const requester = await authService.registerLocal({
      email: 'requester@example.com',
      password: 'password123',
      displayName: 'Requester',
    });
    requesterId = requester.user.id;

    const addressee = await authService.registerLocal({
      email: 'addressee@example.com',
      password: 'password123',
      displayName: 'Addressee',
    });
    addresseeId = addressee.user.id;
  });

  describe('sendRequest', () => {
    it('should send a friend request', async () => {
      const result = await friendsService.sendRequest(requesterId, addresseeId);

      expect(result).toHaveProperty('id');
      expect(result.requesterId).toBe(requesterId);
      expect(result.addresseeId).toBe(addresseeId);
      expect(result.status).toBe('PENDING');

      const dbFriendship = await prisma.friendship.findUnique({ where: { id: result.id } });
      expect(dbFriendship).toBeTruthy();
      expect(dbFriendship!.requesterId).toBe(requesterId);
      expect(dbFriendship!.addresseeId).toBe(addresseeId);
      expect(dbFriendship!.status).toBe('PENDING');
    });

    it('should prevent self-friend', async () => {
      await expect(
        friendsService.sendRequest(requesterId, requesterId),
      ).rejects.toThrow('Cannot friend yourself');
    });

    it('should prevent duplicate requests', async () => {
      await friendsService.sendRequest(requesterId, addresseeId);

      await expect(
        friendsService.sendRequest(requesterId, addresseeId),
      ).rejects.toThrow('Friendship already exists');
    });
  });

  describe('acceptRequest', () => {
    it('should accept a friend request', async () => {
      const friendship = await friendsService.sendRequest(requesterId, addresseeId);

      const accepted = await friendsService.acceptRequest(friendship.id, addresseeId);

      expect(accepted.id).toBe(friendship.id);
      expect(accepted.status).toBe('ACCEPTED');

      const dbFriendship = await prisma.friendship.findUnique({ where: { id: friendship.id } });
      expect(dbFriendship!.status).toBe('ACCEPTED');
    });
  });

  describe('rejectRequest', () => {
    it('should reject a friend request', async () => {
      const friendship = await friendsService.sendRequest(requesterId, addresseeId);

      const rejected = await friendsService.rejectRequest(friendship.id, addresseeId);

      expect(rejected.id).toBe(friendship.id);
      expect(rejected.status).toBe('REJECTED');

      const dbFriendship = await prisma.friendship.findUnique({ where: { id: friendship.id } });
      expect(dbFriendship!.status).toBe('REJECTED');
    });
  });

  describe('listFriends', () => {
    it('should list accepted friends', async () => {
      const friendship = await friendsService.sendRequest(requesterId, addresseeId);
      await friendsService.acceptRequest(friendship.id, addresseeId);

      const friends = await friendsService.listFriends(requesterId);

      expect(friends.length).toBe(1);
      expect(friends[0]).toHaveProperty('requester');
      expect(friends[0]).toHaveProperty('addressee');
      expect(friends[0].requesterId).toBe(requesterId);
      expect(friends[0].addresseeId).toBe(addresseeId);
      expect(friends[0].status).toBe('ACCEPTED');
    });
  });

  describe('listRequests', () => {
    it('should list pending requests for addressee', async () => {
      await friendsService.sendRequest(requesterId, addresseeId);

      const requests = await friendsService.listRequests(addresseeId);

      expect(requests.length).toBe(1);
      expect(requests[0]).toHaveProperty('requester');
      expect(requests[0].requesterId).toBe(requesterId);
      expect(requests[0].addresseeId).toBe(addresseeId);
      expect(requests[0].status).toBe('PENDING');
    });
  });

  describe('sendRequest direction handling', () => {
    it('rejects a reverse-direction pending request', async () => {
      await friendsService.sendRequest(requesterId, addresseeId);
      await expect(
        friendsService.sendRequest(addresseeId, requesterId),
      ).rejects.toThrow('Friendship already exists');
    });

    it('allows re-request after rejection', async () => {
      const f = await friendsService.sendRequest(requesterId, addresseeId);
      await friendsService.rejectRequest(f.id, addresseeId);

      const retry = await friendsService.sendRequest(requesterId, addresseeId);
      expect(retry.status).toBe('PENDING');
    });
  });

  describe('removeFriend authorization', () => {
    it('rejects removal by a non-party', async () => {
      const friendship = await friendsService.sendRequest(requesterId, addresseeId);
      await friendsService.acceptRequest(friendship.id, addresseeId);

      const stranger = await authService.registerLocal({
        email: 'stranger@example.com',
        password: 'password123',
        displayName: 'Stranger',
      });

      await expect(
        friendsService.removeFriend(friendship.id, stranger.user.id),
      ).rejects.toThrow('Not authorized');
    });

    it('allows removal by a party', async () => {
      const friendship = await friendsService.sendRequest(requesterId, addresseeId);
      await friendsService.acceptRequest(friendship.id, addresseeId);

      await expect(
        friendsService.removeFriend(friendship.id, requesterId),
      ).resolves.toBeTruthy();
    });
  });
});
