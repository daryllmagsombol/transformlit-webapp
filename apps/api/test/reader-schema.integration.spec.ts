import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertOwnedDisposableDatabaseUrl, startOwnedDisposableDatabase } from './helpers/pwa-disposable-db.js';

describe('Reader schema', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let container: StartedPostgreSqlContainer | null = null;

  beforeAll(async () => {
    let databaseUrl: string;
    try {
      container = await startOwnedDisposableDatabase();
      databaseUrl = container.getConnectionUri();
    } catch (error) {
      throw new Error('Could not start owned disposable database for reader schema integration test', { cause: error });
    }
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
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

    const canonicalSchemaPath = join(__dirname, '../src/schema.gql');
    const canonicalSchema = readFileSync(canonicalSchemaPath);

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    expect(readFileSync(canonicalSchemaPath)).toEqual(canonicalSchema);
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

  it('stores receipts, tombstones and conflict copies with revision provenance', async () => {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `sync${stamp}@example.com`, emailNormalized: `sync${stamp}@example.com`, displayName: 'Sync Reader' },
    });
    const book = await prisma.book.create({
      data: { title: 'Sync storage', status: 'PUBLISHED', conversionStatus: 'READY', accessLevel: 'FREE' },
    });
    const receipt = await prisma.readerOperationReceipt.create({
      data: { subject: user.id, operationId: `op-${stamp}`, payloadHash: 'hash', result: { kind: 'APPLIED' } },
    });
    expect(receipt.id).toBeTruthy();
    await prisma.readerTombstone.create({ data: { subject: user.id, entityId: `bm-${stamp}`, kind: 'BOOKMARK', revision: 2 } });
    expect(await prisma.readerTombstone.count({ where: { subject: user.id } })).toBe(1);
    await prisma.conflictCopy.create({
      data: {
        subject: user.id,
        operationId: `op-${stamp}`,
        sourceEntityId: `hl-${stamp}`,
        bookId: book.id,
        contentVersion: 1,
        page: 1,
        text: 'offline edit',
        anchor: { version: 1, page: 1, startOffset: 0, endOffset: 5 },
        reason: 'STALE_REVISION',
      },
    });
    expect(await prisma.conflictCopy.count({ where: { subject: user.id } })).toBe(1);
    // Progress defaults to revision 0 (no prior revision) on a legacy row.
    const progress = await prisma.bookProgress.create({ data: { userId: user.id, bookId: book.id, currentPage: 1 } });
    expect(progress.revision).toBe(0);
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
