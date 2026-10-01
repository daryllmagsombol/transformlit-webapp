import { Test, TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { ReaderMutationsService } from '../src/books/reader-mutations.service';
import {
  OperationKind,
  OperationTargetKind,
  OperationResultKind,
} from '../src/books/models/book.model';
import { assertOwnedDisposableDatabaseUrl, startOwnedDisposableDatabase } from './helpers/pwa-disposable-db.js';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';

/**
 * DB-backed proof that queued reader mutations are replay-safe and commit the
 * mutation, conflict copy, and receipt atomically. Requires a live disposable
 * database; BLOCKED wherever Docker/Testcontainers is unavailable and never
 * falls back to a shared database.
 */
describe('Reader sync idempotency', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let books: BooksService;
  let mutations: ReaderMutationsService;
  let container: StartedPostgreSqlContainer | null = null;
  let subject: string;
  let bookId: string;

  beforeAll(async () => {
    let databaseUrl: string;
    try {
      container = await startOwnedDisposableDatabase();
      databaseUrl = container.getConnectionUri();
    } catch (error) {
      throw new Error('Could not start owned disposable database for reader sync integration test', { cause: error });
    }
    assertOwnedDisposableDatabaseUrl(databaseUrl, container);
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    await pool.query(`
      DO $$ DECLARE r RECORD;
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
    prisma = moduleFixture.get(PrismaService);
    auth = moduleFixture.get(AuthService);
    books = moduleFixture.get(BooksService);
    mutations = moduleFixture.get(ReaderMutationsService);

    const stamp = Date.now();
    const registered = await auth.registerLocal({
      email: `reader-sync-${stamp}@example.com`,
      password: 'Password123!',
      displayName: 'Sync Reader',
    });
    subject = registered.user.id;
    const book = await books.uploadBook({ title: `Sync ${stamp}`, accessLevel: 'FREE' as never }, subject);
    bookId = book.id;
    await prisma.book.update({ where: { id: bookId }, data: { status: 'PUBLISHED', conversionStatus: 'READY', pageCount: 5, contentVersion: 1 } });
  }, 180000);

  afterAll(async () => {
    const closeTimeout = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('close timeout')), 15000));
    try {
      await Promise.race([app?.close(), closeTimeout]);
    } catch {
      // ignore
    }
    await container?.stop();
  }, 30000);

  it('commits one mutation and one receipt for a duplicate operation, and replays the stored result', async () => {
    const input = {
      operationId: OPERATION_ID,
      bookId,
      contentVersion: 1,
      kind: OperationKind.PROGRESS_SET,
      baseRevision: 0,
      currentPage: 3,
      scrollY: null,
    } as never;
    const first = await mutations.applyOperation(subject, input);
    const replay = await mutations.applyOperation(subject, input);
    expect(first.result.kind).toBe(OperationResultKind.APPLIED);
    expect(replay.result).toEqual(first.result);
    expect(await prisma.readerOperationReceipt.count({ where: { subject } })).toBe(1);
    expect(await prisma.bookProgress.count({ where: { userId: subject, bookId } })).toBe(1);
  });

  it('rejects operation-ID reuse with a different payload', async () => {
    await expect(
      mutations.applyOperation(subject, {
        operationId: OPERATION_ID,
        bookId,
        contentVersion: 1,
        kind: OperationKind.PROGRESS_SET,
        baseRevision: 1,
        currentPage: 9,
        scrollY: null,
      } as never),
    ).rejects.toThrow(/different payload/i);
  });

  it('soft-deletes a bookmark and retains a tombstone that blocks resurrection', async () => {
    const created = await mutations.applyOperation(subject, {
      operationId: '33333333-3333-4333-8333-333333333333',
      bookId,
      contentVersion: 1,
      kind: OperationKind.BOOKMARK_ADD,
      clientEntityId: CLIENT_ID,
      page: 2,
      label: null,
      color: null,
      anchor: null,
    } as never);
    const entityId = (created.result as { entityId: string }).entityId;
    await mutations.applyOperation(subject, {
      operationId: '44444444-4444-4444-8444-444444444444',
      bookId,
      contentVersion: 1,
      kind: OperationKind.BOOKMARK_REMOVE,
      entityId,
      baseRevision: 1,
    } as never);
    expect(await prisma.readerTombstone.count({ where: { subject, entityId } })).toBe(1);
    const delayed = await mutations.applyOperation(subject, {
      operationId: '55555555-5555-4555-8555-555555555555',
      bookId,
      contentVersion: 1,
      kind: OperationKind.BOOKMARK_ADD,
      clientEntityId: CLIENT_ID,
      page: 2,
      label: null,
      color: null,
      anchor: null,
    } as never);
    expect(delayed.result.kind).toBe(OperationResultKind.CONFLICT);
    expect(await prisma.readerTombstone.count({ where: { subject, entityId } })).toBe(1);
  });

  it('creates a durable conflict copy on a stale annotation edit', async () => {
    const created = await mutations.applyOperation(subject, {
      operationId: '66666666-6666-4666-8666-666666666666',
      bookId,
      contentVersion: 1,
      kind: OperationKind.ANNOTATION_CREATE,
      clientEntityId: '77777777-7777-4777-8777-777777777777',
      page: 2,
      text: 'v1',
      note: null,
      color: null,
      anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 },
    } as never);
    const entityId = (created.result as { entityId: string }).entityId;
    const conflict = await mutations.applyOperation(subject, {
      operationId: '88888888-8888-4888-8888-888888888888',
      bookId,
      contentVersion: 1,
      kind: OperationKind.ANNOTATION_UPDATE,
      entityId,
      targetKind: OperationTargetKind.ANNOTATION,
      baseRevision: 99,
      page: 2,
      text: 'offline',
      note: null,
      color: null,
      anchor: { version: 1, page: 2, startOffset: 0, endOffset: 2 },
    } as never);
    expect(conflict.result.kind).toBe(OperationResultKind.CONFLICT);
    expect(await prisma.conflictCopy.count({ where: { subject, sourceEntityId: entityId } })).toBe(1);
  });

  it('rejects a legacy reader write without mutating or receipting', async () => {
    const before = await prisma.readerOperationReceipt.count({ where: { subject } });
    await expect(books.saveProgress(subject, { bookId, currentPage: 4 } as never)).rejects.toMatchObject({
      extensions: { code: 'UPGRADE_REQUIRED' },
    });
    expect(await prisma.readerOperationReceipt.count({ where: { subject } })).toBe(before);
  });

  it('applies exactly one of two simultaneous same-base progress writes and conflicts the other', async () => {
    const book = await prisma.book.create({
      data: { title: `Race ${Date.now()}`, status: 'PUBLISHED', conversionStatus: 'READY', accessLevel: 'FREE', contentVersion: 1 },
    });
    // Seed revision 0.
    await mutations.applyOperation(subject, {
      operationId: 'aaaaaaaa-0000-4000-8000-000000000001',
      bookId: book.id,
      contentVersion: 1,
      kind: OperationKind.PROGRESS_SET,
      baseRevision: 0,
      currentPage: 5,
      scrollY: null,
    } as never);

    // Launch two concurrent writes that both base on revision 1. Database
    // uniqueness/conditional writes must let exactly one win; the loser must
    // get an explicit CONFLICT, never a silent lost update.
    const [a, b] = await Promise.all([
      mutations.applyOperation(subject, {
        operationId: 'aaaaaaaa-0000-4000-8000-000000000002',
        bookId: book.id,
        contentVersion: 1,
        kind: OperationKind.PROGRESS_SET,
        baseRevision: 1,
        currentPage: 20,
        scrollY: null,
      } as never),
      mutations.applyOperation(subject, {
        operationId: 'aaaaaaaa-0000-4000-8000-000000000003',
        bookId: book.id,
        contentVersion: 1,
        kind: OperationKind.PROGRESS_SET,
        baseRevision: 1,
        currentPage: 30,
        scrollY: null,
      } as never),
    ]);
    const kinds = [a.result.kind, b.result.kind].sort();
    expect(kinds).toEqual([OperationResultKind.APPLIED, OperationResultKind.CONFLICT].sort());
    const progress = await prisma.bookProgress.findUnique({ where: { userId_bookId: { userId: subject, bookId: book.id } } });
    expect(progress?.revision).toBe(2);
    expect([20, 30]).toContain(progress?.currentPage);
  });

  it('returns one durable result for simultaneous duplicate operation IDs', async () => {
    const book = await prisma.book.create({
      data: { title: `Dup ${Date.now()}`, status: 'PUBLISHED', conversionStatus: 'READY', accessLevel: 'FREE', contentVersion: 1 },
    });
    const operationId = 'bbbbbbbb-0000-4000-8000-000000000001';
    const clientEntityId = 'bbbbbbbb-0000-4000-8000-000000000002';
    const input = {
      operationId,
      bookId: book.id,
      contentVersion: 1,
      kind: OperationKind.BOOKMARK_ADD,
      clientEntityId,
      page: 4,
      label: null,
      color: null,
      anchor: null,
    } as never;
    const [a, b] = await Promise.all([mutations.applyOperation(subject, input), mutations.applyOperation(subject, input)]);
    expect(a.result).toEqual(b.result);
    expect(await prisma.readerOperationReceipt.count({ where: { subject, operationId } })).toBe(1);
    expect(await prisma.bookmark.count({ where: { userId: subject, clientEntityId } })).toBe(1);
  });

  it('scopes an entity operation to its declared book', async () => {
    const bookA = await prisma.book.create({
      data: { title: `ScopeA ${Date.now()}`, status: 'PUBLISHED', conversionStatus: 'READY', accessLevel: 'FREE', contentVersion: 1 },
    });
    const bookB = await prisma.book.create({
      data: { title: `ScopeB ${Date.now()}`, status: 'PUBLISHED', conversionStatus: 'READY', accessLevel: 'FREE', contentVersion: 1 },
    });
    const created = await mutations.applyOperation(subject, {
      operationId: 'cccccccc-0000-4000-8000-000000000001',
      bookId: bookA.id,
      contentVersion: 1,
      kind: OperationKind.BOOKMARK_ADD,
      clientEntityId: 'cccccccc-0000-4000-8000-000000000002',
      page: 1,
      label: null,
      color: null,
      anchor: null,
    } as never);
    const entityId = (created.result as { entityId: string }).entityId;
    // Removing through a different book must not touch book A's bookmark.
    const crossBook = await mutations.applyOperation(subject, {
      operationId: 'cccccccc-0000-4000-8000-000000000003',
      bookId: bookB.id,
      contentVersion: 1,
      kind: OperationKind.BOOKMARK_REMOVE,
      entityId,
      baseRevision: 1,
    } as never);
    expect(crossBook.result.kind).toBe(OperationResultKind.ACCESS_DENIED);
    expect(await prisma.bookmark.findUnique({ where: { id: entityId } })).toMatchObject({ deletedAt: null });
  });
});
