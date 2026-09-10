import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Reader schema', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    await app.init();
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
    if (container) {
      await container.stop();
    }
  }, 30000);

  it('applies reader defaults for legacy (seeded) books', async () => {
    const stamp = Date.now();
    const book = await prisma.book.create({ data: { title: `Legacy ${stamp}`, totalPages: 120 } });
    expect(book.conversionStatus).toBe('NOT_APPLICABLE');
    expect(book.contentVersion).toBe(1);
    expect(book.format).toBeNull();
  });

  it('stores pages, toc entries, jobs, sessions and page views', async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `reader${stamp}@example.com`, emailNormalized: `reader${stamp}@example.com`, displayName: 'Reader' },
    });
    const book = await prisma.book.create({
      data: {
        title: 'With pages',
        format: 'PDF',
        pageCount: 2,
        conversionStatus: 'PENDING',
        blobPath: 'books/x/original.pdf',
        pages: { create: [{ index: 1, assetKey: 'a1', textKey: 't1', mimeType: 'image/png' }, { index: 2, assetKey: 'a2' }] },
        tocEntries: { create: [{ title: 'One', page: 1, order: 0 }] },
        conversionJobs: { create: [{ status: 'PENDING' }] },
      },
    });
    expect(await prisma.bookPage.count({ where: { bookId: book.id } })).toBe(2);
    const session = await prisma.readingSession.create({
      data: { userId: user.id, bookId: book.id, tokenHash: `hash-${stamp}`, expiresAt: new Date(Date.now() + 60000) },
    });
    await prisma.pageView.create({ data: { sessionId: session.id, userId: user.id, bookId: book.id, page: 1, contentVersion: 1 } });
    expect(await prisma.pageView.count({ where: { bookId: book.id } })).toBe(1);
  });
});
