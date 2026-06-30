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

  describe('saveProgress', () => {
    let bookId: string;

    beforeEach(async () => {
      const book = await booksService.uploadBook(
        { title: 'Progress Book', accessLevel: BookAccessLevel.FREE },
        testUserId,
      );
      bookId = book.id;
    });

    it('should save reading progress for a user and book', async () => {
      const result = await booksService.saveProgress(testUserId, {
        bookId,
        currentPage: 42,
        scrollY: 500,
      });

      expect(result.bookId).toBe(bookId);
      expect(result.userId).toBe(testUserId);
      expect(result.currentPage).toBe(42);
      expect(result.scrollY).toBe(500);
      expect(result.lastReadAt).toBeTruthy();
    });

    it('should upsert progress on subsequent saves', async () => {
      await booksService.saveProgress(testUserId, {
        bookId,
        currentPage: 10,
      });

      const updated = await booksService.saveProgress(testUserId, {
        bookId,
        currentPage: 20,
        scrollY: 300,
      });

      expect(updated.currentPage).toBe(20);
      expect(updated.scrollY).toBe(300);

      const progress = await prisma.bookProgress.findUnique({
        where: { userId_bookId: { userId: testUserId, bookId } },
      });
      expect(progress?.currentPage).toBe(20);
    });

    it('should retrieve progress via getProgress', async () => {
      await booksService.saveProgress(testUserId, {
        bookId,
        currentPage: 15,
      });

      const progress = await booksService.getProgress(testUserId, bookId);
      expect(progress).toBeTruthy();
      expect(progress?.currentPage).toBe(15);
    });
  });

  describe('addBookmark', () => {
    let bookId: string;

    beforeEach(async () => {
      const book = await booksService.uploadBook(
        { title: 'Bookmark Book', accessLevel: BookAccessLevel.FREE },
        testUserId,
      );
      bookId = book.id;
    });

    it('should add a bookmark to a book', async () => {
      const result = await booksService.addBookmark(testUserId, {
        bookId,
        page: 25,
        label: 'Key Chapter',
        color: '#ff0',
      });

      expect(result).toHaveProperty('id');
      expect(result.bookId).toBe(bookId);
      expect(result.userId).toBe(testUserId);
      expect(result.page).toBe(25);
      expect(result.label).toBe('Key Chapter');
      expect(result.color).toBe('#ff0');
    });

    it('should list bookmarks for a book', async () => {
      await booksService.addBookmark(testUserId, { bookId, page: 10 });
      await booksService.addBookmark(testUserId, { bookId, page: 30, label: 'Second' });

      const bookmarks = await booksService.listBookmarks(testUserId, bookId);
      expect(bookmarks).toHaveLength(2);
      expect(bookmarks[0].page).toBe(10);
      expect(bookmarks[1].page).toBe(30);
    });

    it('should remove a bookmark', async () => {
      const bookmark = await booksService.addBookmark(testUserId, {
        bookId,
        page: 5,
      });

      await booksService.removeBookmark(bookmark.id);

      const bookmarks = await booksService.listBookmarks(testUserId, bookId);
      expect(bookmarks).toHaveLength(0);
    });
  });

  describe('addHighlight', () => {
    let bookId: string;

    beforeEach(async () => {
      const book = await booksService.uploadBook(
        { title: 'Highlight Book', accessLevel: BookAccessLevel.FREE },
        testUserId,
      );
      bookId = book.id;
    });

    it('should add a highlight to a book', async () => {
      const result = await booksService.addHighlight(testUserId, {
        bookId,
        page: 7,
        text: 'This is a highlighted passage',
        note: 'Important quote',
        color: '#0f0',
      });

      expect(result).toHaveProperty('id');
      expect(result.bookId).toBe(bookId);
      expect(result.userId).toBe(testUserId);
      expect(result.page).toBe(7);
      expect(result.text).toBe('This is a highlighted passage');
      expect(result.note).toBe('Important quote');
      expect(result.color).toBe('#0f0');
    });

    it('should list highlights for a book', async () => {
      await booksService.addHighlight(testUserId, {
        bookId,
        page: 3,
        text: 'First highlight',
      });
      await booksService.addHighlight(testUserId, {
        bookId,
        page: 12,
        text: 'Second highlight',
      });

      const highlights = await booksService.listHighlights(testUserId, bookId);
      expect(highlights).toHaveLength(2);
      expect(highlights[0].page).toBe(3);
      expect(highlights[1].page).toBe(12);
    });

    it('should remove a highlight', async () => {
      const highlight = await booksService.addHighlight(testUserId, {
        bookId,
        page: 1,
        text: 'To be removed',
      });

      await booksService.removeHighlight(highlight.id);

      const highlights = await booksService.listHighlights(testUserId, bookId);
      expect(highlights).toHaveLength(0);
    });
  });

  describe('listBookmarks and listHighlights together', () => {
    let bookId: string;

    beforeEach(async () => {
      const book = await booksService.uploadBook(
        { title: 'Combined Book', accessLevel: BookAccessLevel.FREE },
        testUserId,
      );
      bookId = book.id;
    });

    it('should return both bookmarks and highlights independently', async () => {
      await booksService.addBookmark(testUserId, { bookId, page: 5, label: 'BM1' });
      await booksService.addBookmark(testUserId, { bookId, page: 15, label: 'BM2' });
      await booksService.addHighlight(testUserId, { bookId, page: 8, text: 'HL1' });

      const bookmarks = await booksService.listBookmarks(testUserId, bookId);
      const highlights = await booksService.listHighlights(testUserId, bookId);

      expect(bookmarks).toHaveLength(2);
      expect(highlights).toHaveLength(1);
    });

    it('should isolate bookmarks/highlights per user', async () => {
      const user2 = await authService.registerLocal({
        email: 'reader2@example.com',
        password: 'password123',
        displayName: 'Reader 2',
      });
      const user2Id = user2.user.id;

      await booksService.addBookmark(testUserId, { bookId, page: 5 });
      await booksService.addHighlight(testUserId, { bookId, page: 10, text: 'My highlight' });
      await booksService.addBookmark(user2Id, { bookId, page: 20 });

      const user1Bookmarks = await booksService.listBookmarks(testUserId, bookId);
      const user2Bookmarks = await booksService.listBookmarks(user2Id, bookId);
      const user1Highlights = await booksService.listHighlights(testUserId, bookId);
      const user2Highlights = await booksService.listHighlights(user2Id, bookId);

      expect(user1Bookmarks).toHaveLength(1);
      expect(user1Bookmarks[0].page).toBe(5);
      expect(user2Bookmarks).toHaveLength(1);
      expect(user2Bookmarks[0].page).toBe(20);
      expect(user1Highlights).toHaveLength(1);
      expect(user2Highlights).toHaveLength(0);
    });
  });
});
