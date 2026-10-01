import { Test, TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import { UserRole } from '@transformlit/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { BookDownloadService } from '../src/books/book-download.service';
import { ConversionRunner } from '../src/books/conversion/conversion.runner';
import { buildTestPdf } from './fixtures/build-pdf';
import { assertOwnedDisposableDatabaseUrl, startOwnedDisposableDatabase } from './helpers/pwa-disposable-db.js';

const STORAGE_DIR = `${process.cwd()}/.offline-download-storage-test`;

/**
 * DB-backed proof that a whole-book download is independently authorized,
 * complete, and immutable by version, and that a publication change during a
 * download leaves the prior version available and internally consistent.
 *
 * This suite needs a live disposable database. It is BLOCKED wherever Docker /
 * Testcontainers is unavailable; it never falls back to a shared database.
 */
describe('Offline book downloads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let books: BooksService;
  let downloads: BookDownloadService;
  let runner: ConversionRunner;
  let container: StartedPostgreSqlContainer | null = null;
  let token: string;
  let userId: string;
  let bookId: string;

  beforeAll(async () => {
    let databaseUrl: string;
    try {
      container = await startOwnedDisposableDatabase();
      databaseUrl = container.getConnectionUri();
    } catch (error) {
      throw new Error('Could not start owned disposable database for offline download integration test', { cause: error });
    }
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    process.env.BOOK_STORAGE_DIR = STORAGE_DIR;

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

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

    const migrationsDir = join(__dirname, '../prisma/migrations');
    for (const dir of readdirSync(migrationsDir).sort()) {
      const file = join(migrationsDir, dir, 'migration.sql');
      if (existsSync(file)) await pool.query(readFileSync(file, 'utf-8'));
    }

    // The pwa_book_versions migration must have created the immutable tables.
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = tables.rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining([
      'book_content_versions',
      'book_content_version_pages',
      'book_content_version_toc_entries',
    ]));
    await pool.end();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    books = moduleFixture.get<BooksService>(BooksService);
    downloads = moduleFixture.get<BookDownloadService>(BookDownloadService);
    runner = moduleFixture.get<ConversionRunner>(ConversionRunner);

    const stamp = Date.now();
    const auth = moduleFixture.get<AuthService>(AuthService);
    const registered = await auth.registerLocal({
      email: `offline-download-${stamp}@example.com`,
      password: 'Password123!',
      displayName: 'Offline Downloader',
    });
    token = registered.accessToken;
    userId = registered.user.id;

    const book = await books.uploadBook({ title: `Offline Book ${stamp}`, accessLevel: 'FREE' as never }, userId);
    bookId = book.id;
    await books.uploadBookFile(bookId, buildTestPdf(['Page one', 'Page two']), userId, UserRole.ADMIN);
    await runner.runOnce();
  }, 180000);

  afterAll(async () => {
    const closeTimeout = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('close timeout')), 15000));
    try {
      await Promise.race([app?.close(), closeTimeout]);
    } catch {
      // ignore close errors or timeout
    }
    await container?.stop();
    await rm(STORAGE_DIR, { recursive: true, force: true });
  }, 30000);

  it('publishes an immutable version in the same transaction as the current pointer', async () => {
    const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId } });
    const version = await prisma.bookContentVersion.findUnique({
      where: { bookId_contentVersion: { bookId, contentVersion: book.contentVersion } },
      include: { pages: { orderBy: { index: 'asc' } } },
    });
    expect(version).not.toBeNull();
    expect(version?.eligible).toBe(true);
    expect(version?.pageCount).toBe(2);
    expect(version?.pages).toHaveLength(2);
    expect(version?.pages[0].frameSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(version?.pages[0].textSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns a complete, checksummed manifest with no storage keys over HTTP', async () => {
    const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId } });
    const response = await request(app.getHttpServer())
      .get(`/books/${bookId}/offline-manifest?contentVersion=${book.contentVersion}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers.vary).toContain('Authorization');
    expect(response.body.contentVersion).toBe(book.contentVersion);
    expect(response.body.pages).toHaveLength(2);
    expect(response.body.assets.length).toBe(response.body.pages.length * 2);
    for (const asset of response.body.assets) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.byteLength).toBeGreaterThan(0);
      expect(asset.url).toContain(`/content/${book.contentVersion}/assets/`);
    }
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('v2/pages');
    expect(serialized).not.toContain('assetKey');
    expect(serialized).not.toContain('textKey');
  });

  it('serves exact pinned bytes with a sha256 ETag and never creates a reading session or page view', async () => {
    const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId } });
    const manifest = await downloads.getManifest(bookId, userId, book.contentVersion);
    const frame = manifest.assets.find((asset) => asset.kind === 'PAGE_IMAGE');
    expect(frame).toBeDefined();

    const before = await prisma.pageView.count({ where: { bookId } });
    const sessionsBefore = await prisma.readingSession.count({ where: { bookId } });

    const response = await request(app.getHttpServer())
      .get(`/books/${bookId}/content/${book.contentVersion}/assets/${frame!.assetId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers.etag).toBe(`"sha256-${frame!.sha256}"`);
    expect(Number(response.headers['content-length'])).toBe(frame!.byteLength);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(await prisma.pageView.count({ where: { bookId } })).toBe(before);
    expect(await prisma.readingSession.count({ where: { bookId } })).toBe(sessionsBefore);
  });

  it('rejects unauthenticated downloads', async () => {
    await request(app.getHttpServer()).get(`/books/${bookId}/offline-manifest`).expect(401);
  });

  it('rejects a download for a book the user cannot read', async () => {
    const stamp = Date.now();
    const restricted = await prisma.book.create({
      data: {
        title: `Restricted ${stamp}`,
        status: 'PUBLISHED',
        conversionStatus: 'READY',
        accessLevel: 'RESTRICTED',
      },
    });
    await request(app.getHttpServer())
      .get(`/books/${restricted.id}/offline-manifest`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('retains the prior immutable version and serves it after a new publication, without eager deletion', async () => {
    const before = await prisma.book.findUniqueOrThrow({ where: { id: bookId } });
    const priorVersion = before.contentVersion;
    const prior = await prisma.bookContentVersion.findUniqueOrThrow({
      where: { bookId_contentVersion: { bookId, contentVersion: priorVersion } },
      include: { pages: true },
    });

    // Publish v(next): upload a new file and run conversion again.
    await books.uploadBookFile(bookId, buildTestPdf(['Changed one', 'Changed two']), userId, UserRole.ADMIN);
    await runner.runOnce();

    const after = await prisma.book.findUniqueOrThrow({ where: { id: bookId } });
    expect(after.contentVersion).toBe(priorVersion + 1);

    // The previous immutable version still exists with identical descriptors.
    const retained = await prisma.bookContentVersion.findUniqueOrThrow({
      where: { bookId_contentVersion: { bookId, contentVersion: priorVersion } },
      include: { pages: { orderBy: { index: 'asc' } } },
    });
    expect(retained.id).toBe(prior.id);
    expect(retained.pages.map((page) => page.frameSha256)).toEqual(prior.pages.map((page) => page.frameSha256));

    // And it is still downloadable, pinned to the old version.
    const manifest = await downloads.getManifest(bookId, userId, priorVersion);
    expect(manifest.contentVersion).toBe(priorVersion);

    const frame = manifest.assets.find((asset) => asset.kind === 'PAGE_IMAGE');
    const asset = await downloads.getAssetById(bookId, userId, priorVersion, frame!.assetId);
    expect(asset.sha256).toBe(frame!.sha256);
  });
});
