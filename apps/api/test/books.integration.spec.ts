import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { BookAccessLevel } from '@transformlit/shared';
import { assertOwnedDisposableDatabaseUrl } from './helpers/pwa-disposable-db.js';

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

describe('Books Integration', () => {
  let app: INestApplication;
  let booksService: BooksService;
  let authService: AuthService;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;
  let testUserId: string;

  beforeAll(async () => {
    if (!isDockerAvailable()) {
      // No shared-database fallback: these tests reset the schema via
      // `runMigrations`, so running them against an arbitrary TEST_DATABASE_URL
      // would be unsafe. Fail loudly instead of silently targeting a real DB.
      throw new Error('Docker is required for Books Integration tests (Testcontainers); no shared-database fallback is supported');
    }
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('testdb')
      .withUsername('test')
      .withPassword('test')
      .start();
    const databaseUrl = container.getConnectionUri();

    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
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

    booksService = moduleFixture.get<BooksService>(BooksService);
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
    await prisma.highlight.deleteMany();
    await prisma.bookmark.deleteMany();
    await prisma.bookProgress.deleteMany();
    await prisma.book.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();

    const user = await authService.registerLocal({
      email: 'reader@example.com',
      password: 'password123',
      displayName: 'Book Reader',
    });
    testUserId = user.user.id;
  });

  describe('uploadBook', () => {
    it('should create a book in the database', async () => {
      const result = await booksService.uploadBook(
        {
          title: 'Test Book',
          author: 'Test Author',
          description: 'A test book description',
          accessLevel: BookAccessLevel.FREE,
        },
        testUserId,
      );

      expect(result).toHaveProperty('id');
      expect(result.title).toBe('Test Book');
      expect(result.author).toBe('Test Author');
      expect(result.description).toBe('A test book description');
      expect(result.accessLevel).toBe('FREE');
      expect(result.createdById).toBe(testUserId);

      const dbBook = await prisma.book.findUnique({ where: { id: result.id } });
      expect(dbBook).toBeTruthy();
      expect(dbBook?.title).toBe('Test Book');
    });

    it('should set default status to DRAFT', async () => {
      const result = await booksService.uploadBook(
        {
          title: 'Draft Book',
          accessLevel: BookAccessLevel.FREE,
        },
        testUserId,
      );

      expect(result.status).toBe('DRAFT');
    });
  });

  // ── Legacy reader writes are rejected (UPGRADE_REQUIRED) ────────────────────

  describe('legacy reader writes', () => {
    let bookId: string;

    beforeEach(async () => {
      const book = await booksService.uploadBook(
        { title: 'Legacy Writes Book', accessLevel: BookAccessLevel.FREE },
        testUserId,
      );
      bookId = book.id;
    });

    it.each([
      ['saveProgress', () => booksService.saveProgress(testUserId, { bookId, currentPage: 42 })],
      ['addBookmark', () => booksService.addBookmark(testUserId, { bookId, page: 25 })],
      ['removeBookmark', () => booksService.removeBookmark('missing', testUserId)],
      ['addHighlight', () => booksService.addHighlight(testUserId, { bookId, page: 7, text: 'x' })],
      ['removeHighlight', () => booksService.removeHighlight('missing', testUserId)],
    ])('rejects %s without mutating or receipting', async (_name, invoke) => {
      await expect(invoke()).rejects.toMatchObject({ extensions: { code: 'UPGRADE_REQUIRED' } });
      expect(await prisma.readerOperationReceipt.count()).toBe(0);
      expect(await prisma.bookProgress.count()).toBe(0);
      expect(await prisma.bookmark.count()).toBe(0);
      expect(await prisma.highlight.count()).toBe(0);
    });
  });

  describe('reader reads remain available with tombstone exclusion', () => {
    let bookId: string;

    beforeEach(async () => {
      const book = await booksService.uploadBook(
        { title: 'Legacy Reads Book', accessLevel: BookAccessLevel.FREE },
        testUserId,
      );
      bookId = book.id;
    });

    it('lists only non-deleted bookmarks and highlights', async () => {
      await prisma.bookmark.create({ data: { userId: testUserId, bookId, page: 5, clientEntityId: '11111111-1111-4111-8111-111111111111' } });
      await prisma.bookmark.create({ data: { userId: testUserId, bookId, page: 6, clientEntityId: '22222222-2222-4222-8222-222222222222', deletedAt: new Date() } });
      await prisma.highlight.create({ data: { userId: testUserId, bookId, page: 8, text: 'kept', clientEntityId: '33333333-3333-4333-8333-333333333333' } });
      await prisma.highlight.create({ data: { userId: testUserId, bookId, page: 9, text: 'gone', clientEntityId: '44444444-4444-4444-8444-444444444444', deletedAt: new Date() } });

      const bookmarks = await booksService.listBookmarks(testUserId, bookId);
      const highlights = await booksService.listHighlights(testUserId, bookId);
      expect(bookmarks.map((row) => row.page)).toEqual([5]);
      expect(highlights.map((row) => row.page)).toEqual([8]);
    });

    it('isolates bookmarks and highlights per user', async () => {
      const user2 = await authService.registerLocal({
        email: 'reader2@example.com',
        password: 'password123',
        displayName: 'Reader 2',
      });
      const user2Id = user2.user.id;

      await prisma.bookmark.create({ data: { userId: testUserId, bookId, page: 5, clientEntityId: '55555555-5555-4555-8555-555555555555' } });
      await prisma.bookmark.create({ data: { userId: user2Id, bookId, page: 20, clientEntityId: '66666666-6666-4666-8666-666666666666' } });
      await prisma.highlight.create({ data: { userId: testUserId, bookId, page: 10, text: 'mine', clientEntityId: '77777777-7777-4777-8777-777777777777' } });

      expect(await booksService.listBookmarks(testUserId, bookId)).toHaveLength(1);
      expect(await booksService.listBookmarks(user2Id, bookId)).toHaveLength(1);
      expect(await booksService.listHighlights(testUserId, bookId)).toHaveLength(1);
      expect(await booksService.listHighlights(user2Id, bookId)).toHaveLength(0);
    });
  });
});
