import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { graphqlUploadExpress } from 'graphql-upload-ts';
import { rm } from 'node:fs/promises';
import { MAX_FILE_SIZE_BYTES, UserRole } from '@transformlit/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { buildTestPdf } from './fixtures/build-pdf';
import { assertOwnedDisposableDatabaseUrl } from './helpers/pwa-disposable-db.js';

const STORAGE_DIR = `${process.cwd()}/.book-storage-upload-test`;

/**
 * Builds a minimal ZIP/EPUB buffer whose magic bytes match the service's
 * `detectFormat` (PK header + `application/epub+zip` mimetype entry). The
 * conversion is rejected before parsing, so no real EPUB structure is needed.
 */
function buildTestEpub(): Buffer {
  return Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('application/epub+zip')]);
}

/** One GraphQL multipart request as supertest sends it (graphql-multipart spec). */
function uploadRequest(
  server: unknown,
  token: string,
  bookId: string,
  file: Buffer,
  filename: string,
) {
  const operations = {
    query: `mutation UploadPdf($bookId: String!, $file: Upload!) {
      uploadPdf(bookId: $bookId, file: $file) { id format status }
    }`,
    variables: { bookId, file: null },
  };
  return request(server as never)
    .post('/graphql')
    .set('Authorization', `Bearer ${token}`)
    // Real clients (apollo-upload-client) drop the JSON `content-type` for
    // multipart bodies; the server's CSRF prevention therefore requires this
    // non-empty preflight header on uploads. Mirror it here.
    .set('apollo-require-preflight', 'true')
    .field('operations', JSON.stringify(operations))
    .field('map', JSON.stringify({ 0: ['variables.file'] }))
    .attach('0', file, filename);
}

describe('Books upload (GraphQL multipart)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let booksService: BooksService;
  let adminToken: string;
  let adminId: string;
  let memberToken: string;
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
      databaseUrl =
        process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/transformlit_test';
    }

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
    await pool.end();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // Mirror main.ts: the multipart middleware must be registered before the
    // Apollo route so `graphql-upload-ts` can rewrite the request body, and it
    // must be path-scoped to `/graphql` so it does not intercept other
    // multipart routes (e.g. `POST /uploads`).
    app.use(cookieParser());
    app.use('/graphql', graphqlUploadExpress({ maxFileSize: MAX_FILE_SIZE_BYTES }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    authService = moduleFixture.get<AuthService>(AuthService);
    booksService = moduleFixture.get<BooksService>(BooksService);
  }, 180000);

  afterAll(async () => {
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

  beforeEach(async () => {
    await prisma.bookConversionJob.deleteMany();
    await prisma.book.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();

    const admin = await authService.registerLocal({
      email: 'upload-admin@example.com',
      password: 'Password123!',
      displayName: 'Upload Admin',
    });
    adminToken = admin.accessToken;
    adminId = admin.user.id;
    await prisma.user.update({ where: { id: adminId }, data: { role: UserRole.ADMIN } });

    const member = await authService.registerLocal({
      email: 'upload-member@example.com',
      password: 'Password123!',
      displayName: 'Upload Member',
    });
    memberToken = member.accessToken;
  });

  async function createBook(): Promise<string> {
    const book = await booksService.uploadBook(
      { title: 'Upload Target', accessLevel: 'FREE' as never },
      adminId,
    );
    return book.id;
  }

  it('accepts an ADMIN multipart uploadPdf and stores it as a PDF', async () => {
    const bookId = await createBook();
    const response = await uploadRequest(
      app.getHttpServer(),
      adminToken,
      bookId,
      buildTestPdf(['Upload page']),
      'book.pdf',
    );

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data?.uploadPdf).toMatchObject({ id: bookId, format: 'PDF', status: 'PUBLISHED' });
    const stored = await prisma.book.findUnique({ where: { id: bookId } });
    expect(stored?.format).toBe('PDF');
    expect(stored?.conversionStatus).toBe('PENDING');
  });

  it('denies a MEMBER at the GraphQL authorization layer', async () => {
    const bookId = await createBook();
    const response = await uploadRequest(
      app.getHttpServer(),
      memberToken,
      bookId,
      buildTestPdf(['Upload page']),
      'book.pdf',
    );

    expect(response.status).toBe(200);
    // Assert the specific authorization failure so an unrelated error (e.g. a
    // transport/CSRF failure) cannot satisfy this test.
    expect(response.body.data?.uploadPdf ?? null).toBeNull();
    expect(response.body.errors).toHaveLength(1);
    expect(response.body.errors[0].extensions?.code).toBe('FORBIDDEN');
    const stored = await prisma.book.findUnique({ where: { id: bookId } });
    expect(stored?.format).toBeNull();
  });

  it('does not intercept a non-GraphQL multipart route', async () => {
    // `POST /uploads` is a plain multipart image endpoint. If the GraphQL
    // multipart middleware were mounted globally it would reject this body for
    // missing `operations`/`map` with a 400 *before* the JWT guard runs. With
    // the middleware path-scoped to `/graphql`, the request reaches the guard
    // and fails auth instead (401).
    const response = await request(app.getHttpServer() as never)
      .post('/uploads')
      .attach('file', buildTestPdf(['not an image']), 'cover.pdf');

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain('operations');
  });

  it('rejects an EPUB with the typed "coming next release" message', async () => {
    const bookId = await createBook();
    const response = await uploadRequest(
      app.getHttpServer(),
      adminToken,
      bookId,
      buildTestEpub(),
      'book.epub',
    );

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeDefined();
    expect(response.body.errors[0].message).toContain('EPUB support is coming in the next release');
    const stored = await prisma.book.findUnique({ where: { id: bookId } });
    expect(stored?.format).toBeNull();
    expect(await prisma.bookConversionJob.count({ where: { bookId } })).toBe(0);
  });
});
