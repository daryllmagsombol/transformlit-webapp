import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  assertOwnedDisposableDatabaseUrl,
  startOwnedDisposableDatabase,
} from './helpers/pwa-disposable-db.js';

const CREATE_GROUP = `
  mutation CreateGroup($input: CreateGroupInput!) {
    createGroup(input: $input) { id slug }
  }
`;

const CREATE_PLAN = `
  mutation CreatePlan($input: CreateGroupReadingPlanInput!) {
    createGroupReadingPlan(input: $input) {
      id groupId status expectedPercent
      members { percent onPace user { id } }
    }
  }
`;

const READ_PLAN = `
  query ReadPlan($groupId: String!) {
    groupReadingPlan(groupId: $groupId) {
      id status expectedPercent
      members { percent onPace user { id } }
    }
  }
`;

const SHARE = `
  mutation Share($input: ShareHighlightInput!) {
    shareHighlightToGroup(input: $input) {
      id
      sharedBy { id }
      highlight { id page text bookTitle }
    }
  }
`;

const LIST_HIGHLIGHTS = `
  query ListHighlights($groupId: String!) {
    groupHighlights(groupId: $groupId) {
      id
      sharedBy { id }
      highlight { id page text bookTitle }
    }
  }
`;

const UNSHARE = `
  mutation Unshare($shareId: String!) {
    unshareHighlight(shareId: $shareId)
  }
`;

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function runMigrations(pool: Pool): Promise<void> {
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

  const migrationsDir = resolve(__dirname, '../prisma/migrations');
  for (const directory of readdirSync(migrationsDir).sort()) {
    const migrationPath = join(migrationsDir, directory, 'migration.sql');
    if (existsSync(migrationPath)) await pool.query(readFileSync(migrationPath, 'utf8'));
  }
}

describe('Group features integration (plans + shared highlights)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let ownerToken: string;
  let ownerId: string;
  let outsiderToken: string;

  beforeAll(async () => {
    if (!isDockerAvailable()) {
      throw new Error(
        'Docker is required for group-features integration tests (Testcontainers)',
      );
    }

    container = await startOwnedDisposableDatabase();
    const databaseUrl = container.getConnectionUri();
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'group-features-integration-secret';
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

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    const authService = moduleFixture.get<AuthService>(AuthService);

    const owner = await authService.registerLocal({
      email: 'owner@example.com',
      password: 'password123',
      displayName: 'Group Owner',
    });
    if (!owner.user) throw new Error('owner registration failed');
    ownerId = owner.user.id;
    ownerToken = owner.accessToken;

    const outsider = await authService.registerLocal({
      email: 'outsider@example.com',
      password: 'password123',
      displayName: 'Outsider',
    });
    if (!outsider.user) throw new Error('outsider registration failed');
    outsiderToken = outsider.accessToken;
  }, 120000);

  afterAll(async () => {
    const closeTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('close timeout')), 15000),
    );
    try {
      await Promise.race([app?.close(), closeTimeout]);
    } catch {
      // ignore
    }
    await pool?.end();
    await container?.stop();
  }, 30000);

  const gqlAs = (token: string, query: string, variables: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables });

  async function makeGroup(name: string): Promise<string> {
    const res = await gqlAs(ownerToken, CREATE_GROUP, {
      input: { name, visibility: 'PUBLIC' },
    });
    expect(res.body.errors).toBeUndefined();
    return res.body.data.createGroup.id;
  }

  async function makeBook(title: string): Promise<string> {
    const book = await prisma.book.create({
      data: { title, status: 'PUBLISHED', totalPages: 100 },
    });
    return book.id;
  }

  it('creates a plan and returns it with member pacing for every active member', async () => {
    const groupId = await makeGroup('Plan Group');
    const bookId = await makeBook('Usbong');

    const created = await gqlAs(ownerToken, CREATE_PLAN, {
      input: {
        groupId,
        bookId,
        startDate: '2026-01-01T00:00:00.000Z',
        targetDate: '2026-02-01T00:00:00.000Z',
      },
    });
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createGroupReadingPlan.status).toBe('ACTIVE');

    const read = await gqlAs(ownerToken, READ_PLAN, { groupId });
    expect(read.body.errors).toBeUndefined();
    const plan = read.body.data.groupReadingPlan;
    expect(plan).not.toBeNull();
    expect(plan.members.map((m: { user: { id: string } }) => m.user.id)).toContain(ownerId);
  });

  it('rejects plan/highlight reads for a non-member', async () => {
    const groupId = await makeGroup('Private Plan Group');

    const plan = await gqlAs(outsiderToken, READ_PLAN, { groupId });
    expect(plan.body.errors).toBeDefined();

    const highlights = await gqlAs(outsiderToken, LIST_HIGHLIGHTS, { groupId });
    expect(highlights.body.errors).toBeDefined();
  });

  it('archives the prior ACTIVE plan when a new one is created', async () => {
    const groupId = await makeGroup('Archive Group');
    const bookA = await makeBook('Book A');
    const bookB = await makeBook('Book B');

    const first = await gqlAs(ownerToken, CREATE_PLAN, {
      input: { groupId, bookId: bookA, startDate: '2026-01-01T00:00:00.000Z', targetDate: '2026-02-01T00:00:00.000Z' },
    });
    expect(first.body.errors).toBeUndefined();

    const second = await gqlAs(ownerToken, CREATE_PLAN, {
      input: { groupId, bookId: bookB, startDate: '2026-03-01T00:00:00.000Z', targetDate: '2026-04-01T00:00:00.000Z' },
    });
    expect(second.body.errors).toBeUndefined();

    const activeCount = await prisma.groupReadingPlan.count({
      where: { groupId, status: 'ACTIVE' },
    });
    expect(activeCount).toBe(1);

    const read = await gqlAs(ownerToken, READ_PLAN, { groupId });
    expect(read.body.data.groupReadingPlan.id).toBe(second.body.data.createGroupReadingPlan.id);
  });

  it('shares an owned highlight, lists it with relations, and unshares it', async () => {
    const groupId = await makeGroup('Highlight Group');
    const bookId = await makeBook('Shared Book');
    const highlight = await prisma.highlight.create({
      data: { userId: ownerId, bookId, page: 7, text: 'A shared quote' },
    });

    const shared = await gqlAs(ownerToken, SHARE, { input: { groupId, highlightId: highlight.id } });
    expect(shared.body.errors).toBeUndefined();
    expect(shared.body.data.shareHighlightToGroup.highlight.text).toBe('A shared quote');
    expect(shared.body.data.shareHighlightToGroup.sharedBy.id).toBe(ownerId);

    const listed = await gqlAs(ownerToken, LIST_HIGHLIGHTS, { groupId });
    expect(listed.body.errors).toBeUndefined();
    expect(listed.body.data.groupHighlights).toHaveLength(1);
    expect(listed.body.data.groupHighlights[0].highlight.bookTitle).toBe('Shared Book');

    const shareId = listed.body.data.groupHighlights[0].id;
    const unshared = await gqlAs(ownerToken, UNSHARE, { shareId });
    expect(unshared.body.errors).toBeUndefined();
    expect(unshared.body.data.unshareHighlight).toBe(true);

    const after = await gqlAs(ownerToken, LIST_HIGHLIGHTS, { groupId });
    expect(after.body.data.groupHighlights).toHaveLength(0);
  });

  it('rejects sharing a highlight owned by someone else', async () => {
    const groupId = await makeGroup('Other Highlight Group');
    const bookId = await makeBook('Other Book');
    // The highlight belongs to the owner; the outsider tries to share it.
    const ownerHighlight = await prisma.highlight.create({
      data: { userId: ownerId, bookId, page: 2, text: 'owner only' },
    });

    const res = await gqlAs(outsiderToken, SHARE, {
      input: { groupId, highlightId: ownerHighlight.id },
    });
    expect(res.body.errors).toBeDefined();
  });

  it('is idempotent when the same highlight is shared twice', async () => {
    const groupId = await makeGroup('Idempotent Group');
    const bookId = await makeBook('Idempotent Book');
    const highlight = await prisma.highlight.create({
      data: { userId: ownerId, bookId, page: 3, text: 'twice' },
    });

    const first = await gqlAs(ownerToken, SHARE, { input: { groupId, highlightId: highlight.id } });
    const second = await gqlAs(ownerToken, SHARE, { input: { groupId, highlightId: highlight.id } });
    expect(first.body.errors).toBeUndefined();
    expect(second.body.errors).toBeUndefined();
    expect(second.body.data.shareHighlightToGroup.id).toBe(first.body.data.shareHighlightToGroup.id);

    const count = await prisma.groupHighlight.count({
      where: { groupId, highlightId: highlight.id, deletedAt: null },
    });
    expect(count).toBe(1);
  });
});
