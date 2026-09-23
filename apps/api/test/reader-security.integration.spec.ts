import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { rm } from 'node:fs/promises';
import { BookAccessLevel, UserRole } from '@transformlit/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { ConversionRunner } from '../src/books/conversion/conversion.runner';
import { buildTestPdf } from './fixtures/build-pdf';

const STORAGE_DIR = `${process.cwd()}/.book-storage-test`;

describe('Reader security', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let bookId: string;
  let container: StartedPostgreSqlContainer | null = null;

  beforeAll(async () => {
    let databaseUrl: string;
    try {
      const { execSync } = await import('node:child_process');
      execSync('docker info', { stdio: 'ignore' });
      container = await new PostgreSqlContainer('postgres:15-alpine')
        .withDatabase('testdb')
        .withUsername('test')
        .withPassword('test')
        .start();
      databaseUrl = container.getConnectionUri();
    } catch {
      databaseUrl = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/transformlit_test';
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    process.env.BOOK_STORAGE_DIR = STORAGE_DIR;

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    // Reset the public schema so migrations can be applied from scratch
    // (reuse the migration-runner pattern from books.integration.spec.ts).
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
    await pool.end();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    // Match main.ts: the page endpoints read the reading-session cookie from
    // req.cookies, which only exists once cookie-parser is registered.
    app.use(cookieParser());
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    const stamp = Date.now();
    const auth = moduleFixture.get<AuthService>(AuthService);
    const registered = await auth.registerLocal({
      email: `reader-security-${stamp}@example.com`,
      password: 'Password123!',
      displayName: 'Security Reader',
    });
    token = registered.accessToken;

    const books = moduleFixture.get<BooksService>(BooksService);
    const book = await books.uploadBook(
      { title: `Security Book ${stamp}`, accessLevel: BookAccessLevel.FREE },
      registered.user.id,
    );
    bookId = book.id;
    await books.uploadBookFile(
      bookId,
      buildTestPdf(['Secret page one', 'Secret page two']),
      registered.user.id,
      UserRole.ADMIN,
    );

    const runner = moduleFixture.get(ConversionRunner);
    await runner.runOnce();
  }, 180000);

  afterAll(async () => {
    // app.close() can hang on the open throttler/websocket handles; do not let
    // teardown trip jest's hook timeout (mirrors reader-schema.integration.spec.ts).
    const closeTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('close timeout')), 15000),
    );
    try {
      await Promise.race([app?.close(), closeTimeout]);
    } catch {
      // ignore close errors or timeout
    }
    await container?.stop();
    await rm(STORAGE_DIR, { recursive: true, force: true });
  }, 30000);

  it('converts the upload and marks the book READY', async () => {
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    expect(book?.conversionStatus).toBe('READY');
    expect(book?.pageCount).toBe(2);
    expect(book?.format).toBe('PDF');
  });

  it('never exposes storage keys or raw bytes over GraphQL', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: `query { book(id: "${bookId}") { id title format pageCount } }` })
      .expect(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('books/');
    expect(body).not.toContain('blobPath');
    expect(body).not.toContain('%PDF-');
  });

  it('does not expose storage-key fields in the Book GraphQL schema', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: `query { __type(name: "Book") { fields { name } } }` })
      .expect(200);
    const fields = (response.body.data?.__type?.fields ?? []) as Array<{ name: string }>;
    const names = fields.map((field) => field.name);
    expect(names).not.toContain('blobPath');
    expect(names).not.toContain('assetKey');
    expect(names).not.toContain('textKey');
    expect(names).not.toContain('storageKey');
  });

  it('rejects page requests without a reading session', async () => {
    await request(app.getHttpServer()).get(`/books/${bookId}/pages/1/frame`).expect(401);
  });

  it('serves a page frame with a reading session and no-store headers', async () => {
    const session = await request(app.getHttpServer())
      .post(`/books/${bookId}/reading-session`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const cookie = (session.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const frame = await request(app.getHttpServer())
      .get(`/books/${bookId}/pages/1/frame`)
      .set('Cookie', cookie)
      .expect(200);
    expect(frame.headers['cache-control']).toContain('no-store');
    expect(frame.headers['x-content-type-options']).toBe('nosniff');
    expect(Number(frame.headers['content-length'] ?? 0)).toBeGreaterThan(1000);
  });

  it('rejects a page number beyond the page count', async () => {
    const session = await request(app.getHttpServer())
      .post(`/books/${bookId}/reading-session`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const cookie = (session.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    await request(app.getHttpServer()).get(`/books/${bookId}/pages/99/frame`).set('Cookie', cookie).expect(404);
  });

  it('denies bookToc for a book that is not readable', async () => {
    const stamp = Date.now();
    const unreadable = await prisma.book.create({
      data: {
        title: `Unreadable ${stamp}`,
        status: 'PUBLISHED',
        conversionStatus: 'PENDING',
        accessLevel: 'FREE',
      },
    });
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: `query { bookToc(bookId: "${unreadable.id}") { id title page } }` })
      .expect(200);
    expect(response.body.errors).toBeDefined();
    expect(response.body.data?.bookToc ?? null).toBeNull();
  });
});
