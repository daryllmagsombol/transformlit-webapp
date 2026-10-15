import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ConflictException } from '@nestjs/common';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { graphqlUploadExpress } from 'graphql-upload-ts';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BookAccessLevel,
  MAX_FILE_SIZE_BYTES,
  UserRole,
  UserStatus,
} from '@transformlit/shared';
import { execSync } from 'node:child_process';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { AdminUsersService } from '../src/admin/admin-users.service';
import { ConversionRunner } from '../src/books/conversion/conversion.runner';
import { buildTestPdf } from './fixtures/build-pdf';
import { assertOwnedDisposableDatabaseUrl } from './helpers/pwa-disposable-db.js';

const STORAGE_DIR = `${process.cwd()}/.book-storage-admin-authz-test`;
const MEMBER_PASSWORD = 'Password123!';

/** Shape of a GraphQL HTTP response body, narrowed to what these tests assert. */
interface GraphQLResponse {
  status: number;
  body: {
    data?: unknown;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
}

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

  const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
  for (const directory of fs.readdirSync(migrationsDir).sort((a, b) => a.localeCompare(b))) {
    const sqlFile = path.join(migrationsDir, directory, 'migration.sql');
    if (fs.existsSync(sqlFile)) {
      await pool.query(fs.readFileSync(sqlFile, 'utf-8'));
    }
  }
}

/** Staff-only admin reads; each returns a non-null top-level field. */
const ADMIN_QUERIES: Array<{ name: string; query: (bookId: string) => string }> = [
  {
    name: 'adminUsers',
    query: () => 'query { adminUsers { total items { id email role status } } }',
  },
  {
    name: 'auditLogs',
    query: () => 'query { auditLogs { total items { id action } } }',
  },
  {
    name: 'adminPlatformOverview',
    query: () =>
      'query { adminPlatformOverview { totalUsers activeUsers suspendedUsers totalBooks publishedBooks publishedAnnouncements totalGroups } }',
  },
  {
    name: 'adminBookStats',
    query: (bookId) =>
      `query { adminBookStats(bookId: "${bookId}") { bookId title readers completed } }`,
  },
  {
    name: 'adminGroups',
    query: () => 'query { adminGroups { total items { id name slug } } }',
  },
];

describe('Admin authorization matrix (GraphQL layer)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let booksService: BooksService;
  let adminUsersService: AdminUsersService;
  let conversionRunner: ConversionRunner;
  let container: StartedPostgreSqlContainer | null = null;
  let pool: Pool;

  let adminId: string;
  let adminToken: string;
  let moderatorId: string;
  let moderatorToken: string;
  let memberId: string;
  let memberToken: string;
  let memberEmail: string;

  beforeAll(async () => {
    if (!isDockerAvailable()) {
      // No shared-database fallback: these tests reset the schema, so pointing
      // them at TEST_DATABASE_URL would be unsafe. Fail loudly.
      throw new Error('Docker is required for Admin authorization integration tests (Testcontainers)');
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
    process.env.BOOK_STORAGE_DIR = STORAGE_DIR;

    pool = new Pool({ connectionString: databaseUrl });
    await runMigrations(pool);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // Mirror main.ts so the multipart `uploadPdf` path and the reader-session
    // cookie both behave exactly as in production.
    app.use(cookieParser());
    app.use('/graphql', graphqlUploadExpress({ maxFileSize: MAX_FILE_SIZE_BYTES }));
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    authService = moduleFixture.get<AuthService>(AuthService);
    booksService = moduleFixture.get<BooksService>(BooksService);
    adminUsersService = moduleFixture.get<AdminUsersService>(AdminUsersService);
    conversionRunner = moduleFixture.get<ConversionRunner>(ConversionRunner);

    const stamp = Date.now();
    const admin = await authService.registerLocal({
      email: `authz-admin-${stamp}@example.com`,
      password: 'Password123!',
      displayName: 'Authz Admin',
    });
    adminId = admin.user.id;
    adminToken = admin.accessToken;

    const moderator = await authService.registerLocal({
      email: `authz-moderator-${stamp}@example.com`,
      password: 'Password123!',
      displayName: 'Authz Moderator',
    });
    moderatorId = moderator.user.id;
    moderatorToken = moderator.accessToken;

    memberEmail = `authz-member-${stamp}@example.com`;
    const member = await authService.registerLocal({
      email: memberEmail,
      password: MEMBER_PASSWORD,
      displayName: 'Authz Member',
    });
    memberId = member.user.id;
    memberToken = member.accessToken;

    // Access tokens carry only `sub`; the role is read fresh from the DB per
    // request, so these updates take effect for the already-minted tokens.
    await prisma.user.update({ where: { id: adminId }, data: { role: UserRole.ADMIN } });
    await prisma.user.update({ where: { id: moderatorId }, data: { role: UserRole.MODERATOR } });
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
    await pool?.end();
    if (container) {
      await container.stop();
    }
    await rm(STORAGE_DIR, { recursive: true, force: true });
  }, 30000);

  beforeEach(async () => {
    // Books cascade to their pages, sessions, jobs, and page views.
    await prisma.readingSession.deleteMany();
    await prisma.book.deleteMany();
    await prisma.auditLog.deleteMany();
    // Clear refresh-token rows so a prior test's suspension cannot pre-satisfy a
    // later test's "all tokens revoked" assertion. Access tokens are stateless
    // JWTs and stay valid, so the fixtures above remain usable.
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [adminId, moderatorId, memberId] } },
    });

    await prisma.user.updateMany({
      where: { id: { in: [adminId, moderatorId, memberId] } },
      data: { role: UserRole.MEMBER, status: UserStatus.ACTIVE },
    });
    await prisma.user.update({ where: { id: adminId }, data: { role: UserRole.ADMIN } });
    await prisma.user.update({ where: { id: moderatorId }, data: { role: UserRole.MODERATOR } });
  });

  function gql(
    token: string,
    query: string,
    variables?: Record<string, unknown>,
  ) {
    return request(app.getHttpServer() as never)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables });
  }

  /** One GraphQL multipart upload as supertest sends it. */
  function uploadPdfRequest(token: string, bookId: string, file: Buffer) {
    const operations = {
      query: `mutation UploadPdf($bookId: String!, $file: Upload!) {
        uploadPdf(bookId: $bookId, file: $file) { id format status }
      }`,
      variables: { bookId, file: null },
    };
    return request(app.getHttpServer() as never)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .set('apollo-require-preflight', 'true')
      .field('operations', JSON.stringify(operations))
      .field('map', JSON.stringify({ 0: ['variables.file'] }))
      .attach('0', file, 'book.pdf');
  }

  function expectForbidden(response: GraphQLResponse): void {
    expect(response.status).toBe(200);
    expect(response.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    // Non-null root fields collapse to a null body when the guard rejects.
    expect(response.body.data ?? null).toBeNull();
  }

  function expectAuthorized(response: GraphQLResponse): void {
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data ?? null).not.toBeNull();
  }

  async function createBook(createdById: string | null = null): Promise<string> {
    const book = await prisma.book.create({
      data: {
        title: `Authz book ${Date.now()}`,
        accessLevel: BookAccessLevel.FREE,
        createdById,
      },
    });
    return book.id;
  }

  describe('book admin mutations (ADM-15)', () => {
    it('allows ADMIN to uploadBook and denies staff and members', async () => {
      const query = `mutation {
        uploadBook(input: { title: "Authz Upload", accessLevel: FREE }) { id title }
      }`;

      const admin = await gql(adminToken, query);
      expectAuthorized(admin);

      expectForbidden(await gql(moderatorToken, query));
      expectForbidden(await gql(memberToken, query));
    });

    it.each([
      ['uploadPdf', async (bookId: string) => uploadPdfRequest(memberToken, bookId, buildTestPdf(['p']))],
      [
        'updateBook',
        (bookId: string) =>
          gql(memberToken, `mutation { updateBook(id: "${bookId}", input: { title: "Hijack" }) { id } }`),
      ],
      [
        'deleteBook',
        (bookId: string) => gql(memberToken, `mutation { deleteBook(id: "${bookId}") }`),
      ],
      [
        'retryBookConversion',
        (bookId: string) =>
          gql(memberToken, `mutation { retryBookConversion(bookId: "${bookId}") { id } }`),
      ],
    ])('denies a MEMBER %s even when they own the book', async (_name, invoke) => {
      // The book is owned by the member, so only the GraphQL RolesGuard — not
      // the service ownership check — can produce this denial.
      const bookId = await createBook(memberId);
      expectForbidden(await invoke(bookId));
    });

    it('allows a MODERATOR to update and delete a book', async () => {
      const bookId = await createBook(adminId);

      const update = await gql(
        moderatorToken,
        `mutation { updateBook(id: "${bookId}", input: { title: "Renamed" }) { id title } }`,
      );
      expectAuthorized(update);
      expect((update.body.data as { updateBook: { title: string } }).updateBook.title).toBe('Renamed');

      const remove = await gql(moderatorToken, `mutation { deleteBook(id: "${bookId}") }`);
      expectAuthorized(remove);
      const stored = await prisma.book.findUnique({ where: { id: bookId } });
      expect(stored?.deletedAt).not.toBeNull();
    });

    it('allows a MODERATOR to upload a PDF and retry a failed conversion', async () => {
      const uploadTarget = await createBook(adminId);
      const upload = await uploadPdfRequest(
        moderatorToken,
        uploadTarget,
        buildTestPdf(['Moderator page']),
      );
      expectAuthorized(upload);
      expect((upload.body.data as { uploadPdf: { format: string } }).uploadPdf.format).toBe('PDF');

      const failed = await prisma.book.create({
        data: {
          title: `Failed ${Date.now()}`,
          accessLevel: BookAccessLevel.FREE,
          conversionStatus: 'FAILED',
          blobPath: 'books/authz/failed.pdf',
          createdById: adminId,
        },
      });
      const retry = await gql(
        moderatorToken,
        `mutation { retryBookConversion(bookId: "${failed.id}") { id conversionStatus } }`,
      );
      expectAuthorized(retry);
      expect(
        (retry.body.data as { retryBookConversion: { conversionStatus: string } }).retryBookConversion
          .conversionStatus,
      ).toBe('PENDING');
    });
  });

  describe('admin query surface', () => {
    it.each(ADMIN_QUERIES)('denies $name to a MEMBER at the GraphQL layer', async ({ query }) => {
      const bookId = await createBook(adminId);
      expectForbidden(await gql(memberToken, query(bookId)));
    });

    it.each(ADMIN_QUERIES)('allows $name to MODERATOR and ADMIN', async ({ query }) => {
      const bookId = await createBook(adminId);
      expectAuthorized(await gql(moderatorToken, query(bookId)));
      expectAuthorized(await gql(adminToken, query(bookId)));
    });
  });

  describe('admin user mutations', () => {
    it('restricts adminSetUserRole to ADMIN', async () => {
      const query = `mutation {
        adminSetUserRole(input: { userId: "${memberId}", role: MODERATOR }) { id role }
      }`;

      expectForbidden(await gql(memberToken, query));
      expectForbidden(await gql(moderatorToken, query));

      const allowed = await gql(adminToken, query);
      expectAuthorized(allowed);
      expect(
        (allowed.body.data as { adminSetUserRole: { role: string } }).adminSetUserRole.role,
      ).toBe('MODERATOR');
    });

    it('restricts adminSetUserStatus to ADMIN', async () => {
      const query = `mutation {
        adminSetUserStatus(input: { userId: "${memberId}", status: SUSPENDED }) { id status }
      }`;

      expectForbidden(await gql(memberToken, query));
      expectForbidden(await gql(moderatorToken, query));

      const allowed = await gql(adminToken, query);
      expectAuthorized(allowed);
      expect(
        (allowed.body.data as { adminSetUserStatus: { status: string } }).adminSetUserStatus.status,
      ).toBe('SUSPENDED');
    });
  });

  describe('suspension lockout', () => {
    async function createReadyBook(ownerId: string): Promise<string> {
      const book = await booksService.uploadBook(
        { title: `Ready ${Date.now()}`, accessLevel: BookAccessLevel.FREE },
        ownerId,
      );
      await booksService.uploadBookFile(
        book.id,
        buildTestPdf(['Suspension page one', 'Suspension page two']),
        ownerId,
        UserRole.ADMIN,
      );
      await conversionRunner.runOnce();
      return book.id;
    }

    async function openReadingSession(token: string, bookId: string): Promise<string> {
      const session = await request(app.getHttpServer() as never)
        .post(`/books/${bookId}/reading-session`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const [cookie] = session.headers['set-cookie'] as unknown as string[];
      return cookie.split(';')[0];
    }

    it('stops a user suspended mid-read from reading pages or querying GraphQL', async () => {
      const bookId = await createReadyBook(adminId);
      const cookie = await openReadingSession(memberToken, bookId);

      // Healthy read before suspension.
      await request(app.getHttpServer() as never)
        .get(`/books/${bookId}/pages/1/frame`)
        .set('Cookie', cookie)
        .expect(200);

      // Suspend directly (no session revocation) to exercise the reader-session
      // status re-check, not merely the revocation side effect.
      await prisma.user.update({
        where: { id: memberId },
        data: { status: UserStatus.SUSPENDED },
      });

      await request(app.getHttpServer() as never)
        .get(`/books/${bookId}/pages/1/frame`)
        .set('Cookie', cookie)
        .expect(401);

      const read = await gql(memberToken, 'query { adminUsers { total } }');
      expect(read.status).toBe(200);
      expect(read.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
      expect(read.body.data ?? null).toBeNull();
    });

    it('revokes reader sessions and refresh tokens when an admin suspends a user', async () => {
      const bookId = await createReadyBook(adminId);
      await openReadingSession(memberToken, bookId);

      // Mint a fresh refresh token through the real login flow. `beforeEach`
      // clears every refresh row and no other step re-mints one, so this is the
      // member's only refresh token — making the post-suspension assertion
      // non-vacuous (it can only pass if suspension actually revokes it).
      const login = await authService.loginLocal({
        email: memberEmail,
        password: MEMBER_PASSWORD,
      });
      const freshTokenHash = createHash('sha256').update(login.refreshToken).digest('hex');
      const freshToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: freshTokenHash },
      });
      expect(freshToken).not.toBeNull();
      expect(freshToken?.revokedAt).toBeNull();

      const suspend = await gql(
        adminToken,
        `mutation {
          adminSetUserStatus(input: { userId: "${memberId}", status: SUSPENDED }) { id status }
        }`,
      );
      expectAuthorized(suspend);

      const sessions = await prisma.readingSession.findMany({ where: { userId: memberId } });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

      const revokedFreshToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: freshTokenHash },
      });
      expect(revokedFreshToken?.revokedAt).not.toBeNull();

      const refreshTokens = await prisma.refreshToken.findMany({ where: { userId: memberId } });
      expect(refreshTokens).toHaveLength(1);
      expect(refreshTokens.every((token) => token.revokedAt !== null)).toBe(true);
    });
  });

  describe('last active admin guard', () => {
    it('refuses to demote the final active admin (sequential)', async () => {
      await prisma.user.update({ where: { id: moderatorId }, data: { role: UserRole.ADMIN } });

      // Demoting one of two admins is allowed; the second becomes the last.
      await adminUsersService.setRole(adminId, UserRole.MEMBER, moderatorId);

      await expect(
        adminUsersService.setRole(moderatorId, UserRole.MEMBER, adminId),
      ).rejects.toBeInstanceOf(ConflictException);

      const activeAdmins = await prisma.user.count({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
      });
      expect(activeAdmins).toBe(1);
    });

    it('never leaves zero active admins under a concurrent demote/suspend race', async () => {
      await prisma.user.update({ where: { id: moderatorId }, data: { role: UserRole.ADMIN } });

      // Two admins, two concurrent requests each removing one: demote admin A,
      // suspend admin B. Serializable isolation must reject at least one so the
      // invariant (>= 1 active admin) always holds, regardless of interleaving.
      const results = await Promise.allSettled([
        adminUsersService.setRole(adminId, UserRole.MEMBER, moderatorId),
        adminUsersService.setStatus(moderatorId, UserStatus.SUSPENDED, adminId),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled').length;
      const rejected = results.filter((result) => result.status === 'rejected').length;
      expect(rejected).toBeGreaterThanOrEqual(1);
      expect(fulfilled).toBeLessThanOrEqual(1);

      const activeAdmins = await prisma.user.count({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
      });
      expect(activeAdmins).toBeGreaterThanOrEqual(1);
    });
  });
});
