import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { GroupsService } from '../src/groups/groups.service';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { GroupVisibility, GroupCategory } from '@transformlit/shared';

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

describe('Groups Integration', () => {
  let app: INestApplication;
  let groupsService: GroupsService;
  let authService: AuthService;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;
  let testUserId: string;
  let testUser2Id: string;

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

    groupsService = moduleFixture.get<GroupsService>(GroupsService);
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
    await prisma.groupMember.deleteMany();
    await prisma.group.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();

    const user1 = await authService.registerLocal({
      email: 'owner@example.com',
      password: 'password123',
      displayName: 'Group Owner',
    });
    testUserId = user1.user.id;

    const user2 = await authService.registerLocal({
      email: 'member@example.com',
      password: 'password123',
      displayName: 'Group Member',
    });
    testUser2Id = user2.user.id;
  });

  describe('create', () => {
    it('should create a group and verify in database', async () => {
      const result = await groupsService.create(testUserId, {
        name: 'Test Group',
        description: 'A test group',
        visibility: GroupVisibility.PUBLIC,
        category: GroupCategory.PHILOSOPHY,
      });

      expect(result).toHaveProperty('id');
      expect(result.name).toBe('Test Group');
      expect(result.memberCount).toBe(1);
      expect(result.myRole).toBe('OWNER');

      const dbGroup = await prisma.group.findUnique({ where: { id: result.id } });
      expect(dbGroup).toBeTruthy();
      expect(dbGroup!.name).toBe('Test Group');
      expect(dbGroup!.slug).toContain('test-group');
      expect(dbGroup!.visibility).toBe('PUBLIC');
      expect(dbGroup!.category).toBe('PHILOSOPHY');
      expect(dbGroup!.createdById).toBe(testUserId);

      const ownerMembership = await prisma.groupMember.findFirst({
        where: { groupId: result.id, userId: testUserId },
      });
      expect(ownerMembership).toBeTruthy();
      expect(ownerMembership!.role).toBe('OWNER');
      expect(ownerMembership!.status).toBe('ACTIVE');
    });
  });

  describe('join', () => {
    it('should join a PUBLIC group with ACTIVE status', async () => {
      const group = await groupsService.create(testUserId, {
        name: 'Public Group',
        visibility: GroupVisibility.PUBLIC,
      });

      const member = await groupsService.join(group.id, testUser2Id);

      expect(member.groupId).toBe(group.id);
      expect(member.userId).toBe(testUser2Id);
      expect(member.status).toBe('ACTIVE');
    });

    it('should join a PRIVATE group with PENDING status', async () => {
      const group = await groupsService.create(testUserId, {
        name: 'Private Group',
        visibility: GroupVisibility.PRIVATE,
      });

      const member = await groupsService.join(group.id, testUser2Id);

      expect(member.groupId).toBe(group.id);
      expect(member.userId).toBe(testUser2Id);
      expect(member.status).toBe('PENDING');
    });
  });

  describe('leave', () => {
    it('should leave a group and remove membership', async () => {
      const group = await groupsService.create(testUserId, {
        name: 'Leave Group',
        visibility: GroupVisibility.PUBLIC,
      });

      await groupsService.join(group.id, testUser2Id);

      let members = await prisma.groupMember.findMany({
        where: { groupId: group.id },
      });
      expect(members.length).toBe(2);

      await groupsService.leave(group.id, testUser2Id);

      members = await prisma.groupMember.findMany({
        where: { groupId: group.id },
      });
      expect(members.length).toBe(1);
      expect(members[0].userId).toBe(testUserId);
    });
  });

  describe('listMembers', () => {
    it('should list members with user objects', async () => {
      const group = await groupsService.create(testUserId, {
        name: 'Members Group',
        visibility: GroupVisibility.PUBLIC,
      });

      await groupsService.join(group.id, testUser2Id);

      const members = await groupsService.listMembers(group.id);

      expect(members.length).toBe(2);
      expect(members[0]).toHaveProperty('user');
      expect(members[0].user).toHaveProperty('id');
      expect(members[0].user).toHaveProperty('displayName');
      expect(members[1]).toHaveProperty('user');

      const userIds = members.map((m) => m.userId).sort();
      expect(userIds).toEqual([testUser2Id, testUserId].sort());
    });
  });

  describe('updateGroup', () => {
    it('should update group and verify changes', async () => {
      const group = await groupsService.create(testUserId, {
        name: 'Original Name',
        description: 'Original description',
        visibility: GroupVisibility.PUBLIC,
      });

      const updated = await groupsService.updateGroup(group.id, {
        name: 'Updated Name',
        description: 'Updated description',
        visibility: GroupVisibility.PRIVATE,
        featured: true,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Updated description');
      expect(updated.visibility).toBe('PRIVATE');
      expect(updated.featured).toBe(true);

      const dbGroup = await prisma.group.findUnique({ where: { id: group.id } });
      expect(dbGroup!.name).toBe('Updated Name');
      expect(dbGroup!.visibility).toBe('PRIVATE');
      expect(dbGroup!.featured).toBe(true);
    });
  });

  describe('deleteGroup', () => {
    it('should soft delete group with deletedAt', async () => {
      const group = await groupsService.create(testUserId, {
        name: 'Delete Group',
        visibility: GroupVisibility.PUBLIC,
      });

      const deleted = await groupsService.deleteGroup(group.id);

      expect(deleted.id).toBe(group.id);
      expect(deleted.deletedAt).toBeTruthy();

      const dbGroup = await prisma.group.findUnique({ where: { id: group.id } });
      expect(dbGroup!.deletedAt).toBeTruthy();

      const found = await groupsService.findById(group.id);
      expect(found).toBeNull();
    });
  });
});
