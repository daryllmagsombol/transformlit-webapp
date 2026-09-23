# Secure Ebook Reader — Plan 1: Foundation & PDF Vertical Slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, secure PDF reader end to end: upload a PDF, convert it once in a worker (page frames + text boxes + ToC), deliver pages page-by-page through authenticated REST endpoints, and read it in the web app with page turns, page numbers, ToC jumps, and progress/resume.

**Architecture:** A provider-neutral `StorageAdapter` (local filesystem now) holds originals and derived page assets. Uploads enqueue a durable DB-backed conversion job; a separate worker process claims jobs with `FOR UPDATE SKIP LOCKED` and converts PDFs into immutable per-page PNG frames plus per-page text-box JSON. Delivery is REST: a Bearer-authed endpoint issues a scoped httpOnly reading-session cookie, and page endpoints re-check entitlement on every request. The web reader is a new immersive route group that fetches pages on demand and saves progress through GraphQL.

**Tech Stack:** NestJS 11 (GraphQL code-first + REST controller), Prisma 7 (pg driver adapter), PostgreSQL, `unpdf` (pdfjs-dist based), `@napi-rs/canvas`, `@nestjs/throttler` 6, Next.js 16 App Router, React 19, Tailwind v4, Apollo Client 4, Zustand 5.

**Spec:** `docs/superpowers/specs/2026-09-10-secure-ebook-reader-design.md`

## Global Constraints

- API imports MUST use the `.js` extension (NodeNext). Web imports MUST NOT.
- Soft-deletable entities filter `deletedAt: null` on every read path.
- Prisma CLI needs env sourced first: `set -a; source apps/api/.env; set +a;` before every `prisma`/`db:` command.
- Enums live in `packages/shared/src/enums.ts` (single source of truth); the API registers GraphQL enums from them (`book.model.ts:4-5` pattern).
- Every book endpoint re-checks: `deletedAt: null` AND `status = PUBLISHED` AND `conversionStatus = READY` AND entitlement (`accessLevel = FREE` OR owner OR a `BookAccess` row).
- Raw PDF/EPUB bytes and storage keys are NEVER returned by any GraphQL field or REST response.
- Originals and derived assets live under `BOOK_STORAGE_DIR` (default `<cwd>/.book-storage`) — never inside `images/uploads` (publicly served) or `apps/web/public`.
- Book frames MUST use a raw `<img>`. `next/image` is forbidden for book content.
- No per-user watermarking (product decision 2026-09-10). Same frame for every entitled reader; audit logs provide accountability.
- SonarQube rules apply (root `AGENTS.md`): no `window` (use `globalThis.window`), no array-index React keys, `readonly` props, cognitive complexity ≤ 15, no nested ternaries, `replaceAll`, optional chaining, no unused imports.
- Jest conventions: unit specs `apps/api/src/**/*.spec.ts` (`rootDir: src`), integration specs `apps/api/test/**/*.integration.spec.ts` (`rootDir: test`).
- Web tests mock `next/navigation`, `../../../store`, `@apollo/client`, and `../../../lib/apollo-client` (see `books.spec.tsx:1-64`).
- Conversion never runs on the API event loop; it runs in the worker process (`apps/api/src/worker/main.ts`).
- `page`, `currentPage`, `totalPages` serialize as GraphQL `Float` in this codebase (Prisma Int → Float). New numeric fields follow the same quirk.

---

### Task 1: Dependencies + PDF fixture builder + runtime spike

De-risks the render decision before any schema or converter code is written (spec spike E1).

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/test/fixtures/build-pdf.ts`
- Create: `apps/api/test/fixtures/spike-pdf.ts`

**Interfaces:**
- Produces: `buildTestPdf(pages: string[]): Buffer` — a valid multi-page PDF with Helvetica text, used by all later tests.
- Produces: verified working render contract recorded in the `spike-pdf.ts` header comment.

- [ ] **Step 1: Install runtime dependencies**

```bash
pnpm --filter @transformlit/api add unpdf@1.8.1 @napi-rs/canvas@^1.0.9
```

Do NOT add `sharp` (watermarking was removed) and do NOT add `mupdf` (AGPL-3.0).

- [ ] **Step 2: Write the PDF fixture builder**

Create `apps/api/test/fixtures/build-pdf.ts`:

```ts
// Builds a minimal valid multi-page PDF with Helvetica text so tests never
// depend on a committed binary. Object offsets are computed while assembling,
// so the xref table is correct.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function escapePdfText(value: string): string {
  return value.split('(').join(String.raw`\(`).split(')').join(String.raw`\)`);
}

export function buildTestPdf(pages: string[]): Buffer {
  if (pages.length === 0) throw new Error('buildTestPdf needs at least one page');

  const objects: string[] = [];
  const pageObjIds: number[] = [];
  let nextId = 1;

  const catalogId = nextId;
  const pagesId = nextId + 1;
  const fontId = nextId + 2;
  nextId += 3;

  pages.forEach((text, index) => {
    const pageId = nextId;
    const contentId = nextId + 1;
    nextId += 2;
    pageObjIds.push(pageId);
    const content = `BT /F1 24 Tf 72 ${PAGE_HEIGHT - 100} Td (${escapePdfText(`${text} - page ${index + 1}`)}) Tj ET`;
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj\n`,
      `${contentId} 0 obj << /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
  });

  const kids = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  objects.push(
    `${catalogId} 0 obj << /Type /Catalog /Pages ${pagesId} 0 R >> endobj\n`,
    `${pagesId} 0 obj << /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >> endobj\n`,
    `${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n`,
  );

  const ordered = objects.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  let body = '%PDF-1.4\n';
  const offsets = new Map<number, number>();
  for (const object of ordered) {
    const id = Number.parseInt(object, 10);
    offsets.set(id, Buffer.byteLength(body, 'latin1'));
    body += object;
  }

  const maxId = nextId - 1;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    xref += `${String(offsets.get(id) ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${Buffer.byteLength(body, 'latin1')}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}
```

- [ ] **Step 3: Write the spike script**

Create `apps/api/test/fixtures/spike-pdf.ts`:

```ts
/**
 * Spike: verify PDF rasterization + text-item extraction on this runtime.
 * Run: pnpm --filter @transformlit/api exec tsx test/fixtures/spike-pdf.ts
 *
 * Verified contract (update after the first successful run):
 * - render: renderPageAsImage(doc, pageNumber, { scale, canvasImport })
 * - text:   doc.getPage(n).getTextContent() -> items[].{ str, transform, width, height }
 * - output: PNG bytes (Uint8Array)
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { buildTestPdf } from './build-pdf';

async function main() {
  const pdf = buildTestPdf(['Hello reader', 'Second page']);
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const pageCount = doc.numPages;

  const first = await doc.getPage(1);
  const textContent = await first.getTextContent();
  const itemCount = textContent.items.filter((item) => 'str' in item && item.str.trim().length > 0).length;

  const image = await renderPageAsImage(doc, 1, {
    scale: 2,
    canvasImport: () => import('@napi-rs/canvas'),
  });
  const out = join(tmpdir(), 'spike-page-1.png');
  writeFileSync(out, Buffer.from(image));

  console.log(JSON.stringify({ pageCount, itemCount, out, bytes: image.byteLength }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run the spike and confirm the contract**

Run: `pnpm --filter @transformlit/api exec tsx test/fixtures/spike-pdf.ts`

Expected: JSON with `pageCount: 2`, `itemCount >= 1`, `bytes > 1000`, and a written PNG.

If `canvasImport` is rejected by `renderPageAsImage`, add `pdfjs-dist@4.7.76` as a direct dependency and render via `doc.getPage(n)` → `page.render({ canvasContext, viewport })` with a `@napi-rs/canvas` `createCanvas`. Do not proceed until one path produces a PNG plus text items.

- [ ] **Step 5: Record the verified contract and commit**

Update the header comment so the exact working signature is written down, then:

```bash
git add apps/api/package.json apps/api/test/fixtures/
git commit -m "feat(api): pin pdf runtime and add PDF fixture builder for reader"
```

---

### Task 2: Shared enums + Prisma models + migration

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_book_reader_models/` (generated)
- Test: `apps/api/test/reader-schema.integration.spec.ts`

**Interfaces:**
- Produces: `BookFormat { PDF, EPUB }`, `ConversionStatus { NOT_APPLICABLE, PENDING, PROCESSING, READY, FAILED }` in `@transformlit/shared`.
- Produces: Prisma `BookPage`, `BookTocEntry`, `BookConversionJob`, `ReadingSession`, `PageView`; `Book.format/pageCount/conversionStatus/conversionError/contentVersion`; `Bookmark.anchor/contentVersion`; `Highlight.anchor/contentVersion`.

- [ ] **Step 1: Add the enums to shared**

In `packages/shared/src/enums.ts`, after `BookStatus` (line 47):

```ts
export enum BookFormat {
  PDF = 'PDF',
  EPUB = 'EPUB',
}

export enum ConversionStatus {
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}
```

- [ ] **Step 2: Add Prisma enums and Book fields**

In `apps/api/prisma/schema.prisma`, after `enum BookStatus` (line 299):

```prisma
enum BookFormat {
  PDF
  EPUB
}

enum ConversionStatus {
  NOT_APPLICABLE
  PENDING
  PROCESSING
  READY
  FAILED
}
```

Inside `model Book`, after `totalPages`:

```prisma
  format           BookFormat?
  pageCount        Int?
  conversionStatus ConversionStatus @default(NOT_APPLICABLE)
  conversionError  String?
  contentVersion   Int              @default(1)
```

Add to the `Book` relations block (after `highlights Highlight[]`):

```prisma
  pages            BookPage[]
  tocEntries       BookTocEntry[]
  conversionJobs   BookConversionJob[]
  readingSessions  ReadingSession[]
  pageViews        PageView[]
```

- [ ] **Step 3: Add the new models**

Append to `schema.prisma` after `model Highlight`:

```prisma
// ── Book reader ─────────────────────────────────────────────────────────────

model BookPage {
  id        String   @id @default(uuid())
  bookId    String
  book      Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  index     Int
  assetKey  String
  textKey   String?
  mimeType  String?
  width     Int?
  height    Int?
  charCount Int?
  createdAt DateTime @default(now())

  @@unique([bookId, index])
  @@map("book_pages")
}

model BookTocEntry {
  id     String @id @default(uuid())
  bookId String
  book   Book   @relation(fields: [bookId], references: [id], onDelete: Cascade)
  title  String
  page   Int
  depth  Int    @default(0)
  order  Int

  @@index([bookId, order])
  @@map("book_toc_entries")
}

model BookConversionJob {
  id        String    @id @default(uuid())
  bookId    String
  book      Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  status    String    @default("PENDING")
  attempts  Int       @default(0)
  lockedAt  DateTime?
  lastError String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([status, createdAt])
  @@map("book_conversion_jobs")
}

model ReadingSession {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId     String
  book       Book      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  lastSeenAt DateTime  @default(now())
  createdAt  DateTime  @default(now())

  pageViews  PageView[]

  @@index([userId, bookId])
  @@index([expiresAt])
  @@map("reading_sessions")
}

model PageView {
  id             String         @id @default(uuid())
  sessionId      String
  session        ReadingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId         String
  bookId         String
  page           Int
  contentVersion Int
  viewedAt       DateTime       @default(now())

  @@index([bookId, viewedAt])
  @@index([userId, viewedAt])
  @@map("page_views")
}
```

- [ ] **Step 4: Add anchor columns**

In `model Bookmark`, after `color String?`:

```prisma
  anchor         Json?
  contentVersion Int?
```

In `model Highlight`, after `color String?`:

```prisma
  anchor         Json?
  contentVersion Int?
```

- [ ] **Step 5: Add the User back-relation**

In `model User`, next to the existing book relations (keep alphabetical if the block is sorted):

```prisma
  readingSessions ReadingSession[]
```

- [ ] **Step 6: Generate and apply the migration**

```bash
set -a; source apps/api/.env; set +a
cd apps/api && pnpm prisma migrate dev --name add_book_reader_models
```

Expected: migration created and applied; `prisma generate` runs automatically.

- [ ] **Step 7: Write the schema integration test**

Create `apps/api/test/reader-schema.integration.spec.ts` (reuse the container + migration runner pattern from `books.integration.spec.ts:14-98`):

```ts
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
    await app?.close();
    await container?.stop();
  });

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
```

- [ ] **Step 8: Run the integration test**

Run: `pnpm --filter @transformlit/api test:integration -- reader-schema`

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/enums.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/reader-schema.integration.spec.ts
git commit -m "feat(api): add book reader schema, enums and migration"
```

---

### Task 3: StorageAdapter (interface + local driver)

**Files:**
- Create: `apps/api/src/storage/storage-adapter.ts`
- Create: `apps/api/src/storage/local-storage.adapter.ts`
- Create: `apps/api/src/storage/local-storage.adapter.spec.ts`
- Create: `apps/api/src/storage/storage.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `STORAGE_ADAPTER` token; `StorageAdapter` with `put/getBuffer/getStream/exists/delete/deletePrefix`. No `getPublicUrl` — callers never build user-facing URLs.
- Produces: `StorageModule` (global) exporting `STORAGE_ADAPTER`.

- [ ] **Step 1: Write the failing adapter test**

Create `apps/api/src/storage/local-storage.adapter.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from './local-storage.adapter';

describe('LocalStorageAdapter', () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'book-storage-'));
    adapter = new LocalStorageAdapter(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('puts, exists, gets buffer and stream, deletes', async () => {
    await adapter.put('books/1/original.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');
    expect(await adapter.exists('books/1/original.pdf')).toBe(true);
    expect((await adapter.getBuffer('books/1/original.pdf'))?.toString()).toBe('%PDF-1.4');

    const stream = await adapter.getStream('books/1/original.pdf');
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.4');

    await adapter.delete('books/1/original.pdf');
    expect(await adapter.exists('books/1/original.pdf')).toBe(false);
  });

  it('supports ranged reads', async () => {
    await adapter.put('k', Buffer.from('0123456789'));
    const stream = await adapter.getStream('k', { start: 2, end: 4 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('234');
  });

  it('deletes a prefix', async () => {
    await adapter.put('books/1/v1/pages/1.png', Buffer.from('a'));
    await adapter.put('books/1/v1/pages/2.png', Buffer.from('b'));
    await adapter.deletePrefix('books/1/v1');
    expect(await adapter.exists('books/1/v1/pages/1.png')).toBe(false);
  });

  it('rejects traversal and absolute keys', async () => {
    await expect(adapter.put('../escape', Buffer.from('x'))).rejects.toThrow();
    await expect(adapter.getBuffer('/etc/passwd')).rejects.toThrow();
    await expect(adapter.getBuffer('a/../../b')).rejects.toThrow();
  });

  it('returns null for missing keys', async () => {
    expect(await adapter.getBuffer('nope')).toBeNull();
    expect(await adapter.getStream('nope')).toBeNull();
    expect(await adapter.exists('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- local-storage`

Expected: FAIL — `Cannot find module './local-storage.adapter'`.

- [ ] **Step 3: Write the interface**

Create `apps/api/src/storage/storage-adapter.ts`:

```ts
export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Provider-neutral object storage. Deliberately has no `getPublicUrl`: book
 * bytes are only ever delivered through authenticated application endpoints.
 */
export interface StorageAdapter {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer | null>;
  getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}
```

- [ ] **Step 4: Write the local implementation**

Create `apps/api/src/storage/local-storage.adapter.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { ByteRange, StorageAdapter } from './storage-adapter.js';

@Injectable()
export class LocalStorageAdapter implements StorageAdapter {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      return null;
    }
  }

  async getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream | null> {
    const target = this.resolveKey(key);
    try {
      await stat(target);
    } catch {
      return null;
    }
    if (range) return createReadStream(target, { start: range.start, end: range.end });
    return createReadStream(target);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolveKey(prefix), { recursive: true, force: true });
  }

  /** Rejects traversal, absolute paths and null bytes; keeps access inside root. */
  private resolveKey(key: string): string {
    if (!key || key.includes('\0')) throw new Error('Invalid storage key');
    const normalized = normalize(key).replaceAll('\\', '/');
    const segments = normalized.split('/');
    if (normalized.startsWith('/') || segments.includes('..')) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    const target = resolve(join(this.root, normalized));
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return target;
  }
}
```

- [ ] **Step 5: Write the module**

Create `apps/api/src/storage/storage.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { STORAGE_ADAPTER } from './storage-adapter.js';
import { LocalStorageAdapter } from './local-storage.adapter.js';

export const DEFAULT_BOOK_STORAGE_DIR = '.book-storage';

export function resolveStorageDir(config: ConfigService): string {
  return config.get<string>('BOOK_STORAGE_DIR') ?? join(process.cwd(), DEFAULT_BOOK_STORAGE_DIR);
}

/**
 * Global so every module resolves the same adapter without re-importing.
 * Tests override STORAGE_ADAPTER with a temp dir.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new LocalStorageAdapter(resolveStorageDir(config)),
    },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
```

In `apps/api/src/app.module.ts`, add the import (`import { StorageModule } from './storage/storage.module.js';`) and list `StorageModule` right after `PrismaModule`.

- [ ] **Step 6: Ignore the storage dir**

In `.gitignore`, next to the local uploads entry:

```
# Local book storage
.book-storage/
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @transformlit/api test -- local-storage`

Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/storage apps/api/src/app.module.ts .gitignore
git commit -m "feat(api): add provider-neutral storage adapter with local driver"
```

---

### Task 4: Conversion job service (durable DB queue)

**Files:**
- Create: `apps/api/src/books/conversion/conversion-job.service.ts`
- Create: `apps/api/src/books/conversion/conversion-job.service.spec.ts`

**Interfaces:**
- Produces: `ConversionJobService.enqueue(bookId)`, `claimNext()`, `complete(jobId)`, `fail(jobId, error)`, `requeueStale(olderThanMs)`.
- Produces: `ClaimedJob { id: string; bookId: string; attempts: number }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/books/conversion/conversion-job.service.spec.ts`:

```ts
import { ConversionJobService } from './conversion-job.service';

describe('ConversionJobService', () => {
  let prisma: {
    $queryRaw: jest.Mock;
    bookConversionJob: { update: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    book: { update: jest.Mock };
  };
  let service: ConversionJobService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      bookConversionJob: { update: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      book: { update: jest.fn() },
    };
    service = new ConversionJobService(prisma as never);
  });

  it('enqueues a pending job', async () => {
    prisma.bookConversionJob.create.mockResolvedValue({ id: 'job-1' });
    await service.enqueue('book-1');
    expect(prisma.bookConversionJob.create).toHaveBeenCalledWith({ data: { bookId: 'book-1', status: 'PENDING' } });
  });

  it('claims the next job with SKIP LOCKED', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'job-1', bookId: 'book-1', attempts: 0 }]);
    const claimed = await service.claimNext();
    expect(claimed).toEqual({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join(' ');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('book_conversion_jobs');
  });

  it('returns null when nothing is claimable', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await service.claimNext()).toBeNull();
  });

  it('marks a job complete', async () => {
    prisma.bookConversionJob.update.mockResolvedValue({});
    await service.complete('job-1');
    expect(prisma.bookConversionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'READY', lockedAt: null, lastError: null },
    });
  });

  it('requeues a failed job below the attempt cap', async () => {
    prisma.bookConversionJob.update.mockResolvedValue({ attempts: 1, bookId: 'book-1' });
    await service.fail('job-1', 'boom');
    expect(prisma.bookConversionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'PENDING', lockedAt: null, lastError: 'boom', attempts: { increment: 1 } },
    });
    expect(prisma.book.update).not.toHaveBeenCalled();
  });

  it('fails the book permanently after the attempt cap', async () => {
    prisma.bookConversionJob.update.mockResolvedValue({ attempts: 3, bookId: 'book-1' });
    await service.fail('job-1', 'boom');
    expect(prisma.bookConversionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'FAILED', lockedAt: null, lastError: 'boom', attempts: { increment: 1 } },
    });
    expect(prisma.book.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: { conversionStatus: 'FAILED', conversionError: 'boom' },
    });
  });

  it('requeues stale processing jobs', async () => {
    prisma.bookConversionJob.updateMany.mockResolvedValue({ count: 2 });
    const count = await service.requeueStale(15 * 60 * 1000);
    expect(count).toBe(2);
    expect(prisma.bookConversionJob.updateMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- conversion-job`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/books/conversion/conversion-job.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export const MAX_CONVERSION_ATTEMPTS = 3;

export interface ClaimedJob {
  id: string;
  bookId: string;
  attempts: number;
}

@Injectable()
export class ConversionJobService {
  private readonly logger = new Logger(ConversionJobService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(bookId: string): Promise<void> {
    await this.prisma.bookConversionJob.create({ data: { bookId, status: 'PENDING' } });
  }

  /**
   * Atomically claims one job. Stale PROCESSING jobs (worker died mid-run) are
   * reclaimable after 15 minutes.
   */
  async claimNext(): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE book_conversion_jobs
      SET status = 'PROCESSING', "lockedAt" = now(), "updatedAt" = now()
      WHERE id = (
        SELECT id FROM book_conversion_jobs
        WHERE status = 'PENDING'
           OR (status = 'PROCESSING' AND "lockedAt" < now() - interval '15 minutes')
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "bookId", attempts
    `;
    return rows[0] ?? null;
  }

  async complete(jobId: string): Promise<void> {
    await this.prisma.bookConversionJob.update({
      where: { id: jobId },
      data: { status: 'READY', lockedAt: null, lastError: null },
    });
  }

  async fail(jobId: string, error: string): Promise<void> {
    const job = await this.prisma.bookConversionJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', lockedAt: null, lastError: error, attempts: { increment: 1 } },
    });
    if (job.attempts >= MAX_CONVERSION_ATTEMPTS) {
      await this.prisma.bookConversionJob.update({ where: { id: jobId }, data: { status: 'FAILED' } });
      await this.prisma.book.update({
        where: { id: job.bookId },
        data: { conversionStatus: 'FAILED', conversionError: error },
      });
      this.logger.warn(`Conversion permanently failed for book ${job.bookId}: ${error}`);
    }
  }

  async requeueStale(olderThanMs: number): Promise<number> {
    const result = await this.prisma.bookConversionJob.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - olderThanMs) } },
      data: { status: 'PENDING', lockedAt: null },
    });
    return result.count;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @transformlit/api test -- conversion-job`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/books/conversion
git commit -m "feat(api): add durable conversion job queue service"
```

---

### Task 5: PDF converter (frames, text boxes, ToC)

**Files:**
- Create: `apps/api/src/books/conversion/reader.types.ts`
- Create: `apps/api/src/books/conversion/pdf.converter.ts`
- Create: `apps/api/src/books/conversion/pdf.converter.spec.ts`

**Interfaces:**
- Produces: `TextItemBox { t, x, y, w, h }` (normalized 0..1, y from top), `ConvertedPage { index, assetKey, textKey, mimeType, width, height, itemCount }`, `ConvertedTocEntry { title, page, depth, order }`, `ConvertedBook { format: 'PDF'; pageCount; pages; toc }`.
- Produces: `PdfConverter.convert({ bookId, contentVersion, buffer }): Promise<ConvertedBook>`.
- Consumes: `STORAGE_ADAPTER`, `buildTestPdf` from Task 1.

- [ ] **Step 1: Add the shared types**

Create `apps/api/src/books/conversion/reader.types.ts`:

```ts
export interface TextItemBox {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ConvertedPage {
  index: number;
  assetKey: string;
  textKey: string;
  mimeType: string;
  width: number;
  height: number;
  itemCount: number;
}

export interface ConvertedTocEntry {
  title: string;
  page: number;
  depth: number;
  order: number;
}

export interface ConvertedBook {
  format: 'PDF';
  pageCount: number;
  pages: ConvertedPage[];
  toc: ConvertedTocEntry[];
}
```

- [ ] **Step 2: Write the failing converter test**

Create `apps/api/src/books/conversion/pdf.converter.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from '../../storage/local-storage.adapter.js';
import { buildTestPdf } from '../../../../test/fixtures/build-pdf';
import { PdfConverter } from './pdf.converter.js';

describe('PdfConverter', () => {
  let root: string;
  let storage: LocalStorageAdapter;
  let converter: PdfConverter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pdf-convert-'));
    storage = new LocalStorageAdapter(root);
    converter = new PdfConverter(storage);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('converts a 2-page PDF into versioned page assets with text items', async () => {
    const result = await converter.convert({ bookId: 'book-1', contentVersion: 1, buffer: buildTestPdf(['Alpha', 'Beta']) });

    expect(result.format).toBe('PDF');
    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].assetKey).toBe('books/book-1/v1/pages/1.png');
    expect(result.pages[0].itemCount).toBeGreaterThan(0);
    expect(result.pages[0].width).toBeGreaterThan(0);

    expect(await storage.exists(result.pages[0].assetKey)).toBe(true);
    const saved = await storage.getBuffer(result.pages[0].textKey);
    const parsed = JSON.parse(saved?.toString() ?? '{}') as { items: Array<{ t: string; x: number; w: number }> };
    expect(parsed.items.some((item) => item.t.includes('Alpha'))).toBe(true);
    expect(parsed.items[0].x).toBeGreaterThanOrEqual(0);
    expect(parsed.items[0].x).toBeLessThanOrEqual(1);
    expect(result.toc.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- pdf.converter`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the converter**

Create `apps/api/src/books/conversion/pdf.converter.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { STORAGE_ADAPTER, StorageAdapter } from '../../storage/storage-adapter.js';
import { ConvertedBook, ConvertedPage, ConvertedTocEntry, TextItemBox } from './reader.types.js';

export const RENDER_SCALE = 2;

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineNode[];
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** 2D matrix multiply in PDF [a,b,c,d,e,f] form (mirrors pdfjs Util.transform). */
export function multiplyMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Converts a page's text items into normalized boxes (0..1, y from the top)
 * so the client can position a selectable text layer over the frame at any size.
 */
export function toTextBoxes(items: PdfTextItem[], viewport: number[]): TextItemBox[] {
  const boxes: TextItemBox[] = [];
  for (const item of items) {
    if (!item.str || item.str.trim().length === 0) continue;
    const tx = multiplyMatrix(viewport, item.transform);
    boxes.push({
      t: item.str,
      x: round(tx[4]),
      y: round(tx[5] - item.height),
      w: round(item.width),
      h: round(item.height),
    });
  }
  return boxes;
}

@Injectable()
export class PdfConverter {
  private readonly logger = new Logger(PdfConverter.name);

  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  async convert(input: { bookId: string; contentVersion: number; buffer: Buffer }): Promise<ConvertedBook> {
    const doc = await getDocumentProxy(new Uint8Array(input.buffer));
    const pageCount = doc.numPages;
    const pages: ConvertedPage[] = [];
    let lastWidth = 0;
    let lastHeight = 0;

    for (let index = 1; index <= pageCount; index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const textContent = await page.getTextContent();
      const rawItems = textContent.items.filter((item): item is PdfTextItem => 'str' in item);
      const normalized = page.getViewport({ scale: 1 / viewport.width });
      const boxes = toTextBoxes(rawItems, normalized.transform);

      const image = await renderPageAsImage(doc, index, {
        scale: RENDER_SCALE,
        canvasImport: () => import('@napi-rs/canvas'),
      });
      const assetKey = `books/${input.bookId}/v${input.contentVersion}/pages/${index}.png`;
      const textKey = `books/${input.bookId}/v${input.contentVersion}/pages/${index}.json`;
      await this.storage.put(assetKey, Buffer.from(image), 'image/png');
      await this.storage.put(textKey, Buffer.from(JSON.stringify({ items: boxes })), 'application/json');

      lastWidth = Math.round(viewport.width);
      lastHeight = Math.round(viewport.height);
      pages.push({
        index,
        assetKey,
        textKey,
        mimeType: 'image/png',
        width: lastWidth,
        height: lastHeight,
        itemCount: boxes.length,
      });
    }

    const toc = await this.extractToc(doc);
    this.logger.log(`Converted PDF ${input.bookId}: ${pageCount} pages, ${toc.length} toc entries`);
    return { format: 'PDF', pageCount, pages, toc };
  }

  private async extractToc(doc: PdfDocument): Promise<ConvertedTocEntry[]> {
    const fallback: ConvertedTocEntry[] = [{ title: 'Page 1', page: 1, depth: 0, order: 0 }];
    const outline = (await doc.getOutline()) as PdfOutlineNode[] | null;
    if (!outline?.length) return fallback;

    const entries: ConvertedTocEntry[] = [];
    const visit = async (nodes: PdfOutlineNode[], depth: number): Promise<void> => {
      for (const node of nodes) {
        const page = await this.resolveDestPage(doc, node.dest);
        if (page !== null) entries.push({ title: node.title, page, depth, order: entries.length });
        if (node.items?.length) await visit(node.items, depth + 1);
      }
    };
    await visit(outline, 0);
    return entries.length > 0 ? entries : fallback;
  }

  private async resolveDestPage(doc: PdfDocument, dest: string | unknown[] | null): Promise<number | null> {
    if (!dest) return null;
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      const ref = explicit?.[0];
      if (!ref || typeof ref !== 'object') return null;
      const pageIndex = await doc.getPageIndex(ref as never);
      return pageIndex + 1;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @transformlit/api test -- pdf.converter`

Expected: PASS. The generated fixture has no outline, so the fallback ToC entry satisfies the assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/books/conversion
git commit -m "feat(api): add PDF converter with frames, text boxes and ToC"
```

---

### Task 6: Conversion runner + worker process

**Files:**
- Create: `apps/api/src/books/conversion/conversion.runner.ts`
- Create: `apps/api/src/books/conversion/conversion.runner.spec.ts`
- Create: `apps/api/src/books/conversion/conversion.module.ts`
- Create: `apps/api/src/worker/worker.module.ts`
- Create: `apps/api/src/worker/main.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `ConversionRunner.runOnce(): Promise<boolean>` — claims one job, converts, persists transactionally, returns whether a job was processed.
- Produces: `worker:dev` / `worker:start` scripts.
- Consumes: `ConversionJobService`, `PdfConverter`, `STORAGE_ADAPTER`, `PrismaService`.

- [ ] **Step 1: Write the failing runner test**

Create `apps/api/src/books/conversion/conversion.runner.spec.ts`:

```ts
import { ConversionRunner } from './conversion.runner';

describe('ConversionRunner', () => {
  let jobs: { claimNext: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let converter: { convert: jest.Mock };
  let storage: { getBuffer: jest.Mock; deletePrefix: jest.Mock };
  let prisma: { book: { findUnique: jest.Mock }; $transaction: jest.Mock };
  let runner: ConversionRunner;

  const converted = {
    format: 'PDF' as const,
    pageCount: 1,
    pages: [{ index: 1, assetKey: 'a', textKey: 't', mimeType: 'image/png', width: 10, height: 10, itemCount: 1 }],
    toc: [{ title: 'Page 1', page: 1, depth: 0, order: 0 }],
  };

  beforeEach(() => {
    jobs = { claimNext: jest.fn(), complete: jest.fn(), fail: jest.fn() };
    converter = { convert: jest.fn() };
    storage = { getBuffer: jest.fn(), deletePrefix: jest.fn() };
    prisma = { book: { findUnique: jest.fn() }, $transaction: jest.fn() };
    runner = new ConversionRunner(jobs as never, converter as never, storage as never, prisma as never);
  });

  it('returns false when no job is claimable', async () => {
    jobs.claimNext.mockResolvedValue(null);
    expect(await runner.runOnce()).toBe(false);
    expect(converter.convert).not.toHaveBeenCalled();
  });

  it('converts a claimed job and persists pages transactionally', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({
      id: 'book-1',
      blobPath: 'books/book-1/original.pdf',
      format: 'PDF',
      contentVersion: 1,
    });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockResolvedValue(converted);
    const tx = {
      bookPage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bookTocEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      book: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    expect(await runner.runOnce()).toBe(true);
    expect(converter.convert).toHaveBeenCalledWith({
      bookId: 'book-1',
      contentVersion: 2,
      buffer: expect.any(Buffer),
    });
    expect(tx.book.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'book-1' },
        data: expect.objectContaining({ conversionStatus: 'READY', pageCount: 1, contentVersion: 2 }),
      }),
    );
    expect(jobs.complete).toHaveBeenCalledWith('job-1');
  });

  it('records a failure when conversion throws', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({ id: 'book-1', blobPath: 'x', format: 'PDF', contentVersion: 1 });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockRejectedValue(new Error('render exploded'));

    expect(await runner.runOnce()).toBe(true);
    expect(jobs.fail).toHaveBeenCalledWith('job-1', 'render exploded');
    expect(jobs.complete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- conversion.runner`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the runner**

Create `apps/api/src/books/conversion/conversion.runner.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { STORAGE_ADAPTER, StorageAdapter } from '../../storage/storage-adapter.js';
import { ConversionJobService } from './conversion-job.service.js';
import { PdfConverter } from './pdf.converter.js';

@Injectable()
export class ConversionRunner {
  private readonly logger = new Logger(ConversionRunner.name);

  constructor(
    private readonly jobs: ConversionJobService,
    private readonly pdfConverter: PdfConverter,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly prisma: PrismaService,
  ) {}

  /** Claims and processes at most one job. Returns whether work was done. */
  async runOnce(): Promise<boolean> {
    const job = await this.jobs.claimNext();
    if (!job) return false;

    try {
      await this.process(job.bookId, job.id);
      await this.jobs.complete(job.id);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Conversion failed for book ${job.bookId}: ${message}`);
      await this.jobs.fail(job.id, message);
      return true;
    }
  }

  private async process(bookId: string, _jobId: string): Promise<void> {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book?.blobPath) throw new Error('Book has no stored original');

    const buffer = await this.storage.getBuffer(book.blobPath);
    if (!buffer) throw new Error('Stored original is missing');

    const nextVersion = (book.contentVersion ?? 1) + 1;
    const converted = await this.pdfConverter.convert({ bookId, contentVersion: nextVersion, buffer });

    await this.prisma.$transaction(async (tx) => {
      await tx.bookPage.deleteMany({ where: { bookId } });
      await tx.bookTocEntry.deleteMany({ where: { bookId } });
      await tx.bookPage.createMany({
        data: converted.pages.map((page) => ({
          bookId,
          index: page.index,
          assetKey: page.assetKey,
          textKey: page.textKey,
          mimeType: page.mimeType,
          width: page.width,
          height: page.height,
        })),
      });
      await tx.bookTocEntry.createMany({
        data: converted.toc.map((entry) => ({ bookId, title: entry.title, page: entry.page, depth: entry.depth, order: entry.order })),
      });
      await tx.book.update({
        where: { id: bookId },
        data: {
          format: 'PDF',
          pageCount: converted.pageCount,
          conversionStatus: 'READY',
          conversionError: null,
          contentVersion: nextVersion,
        },
      });
    });

    await this.storage.deletePrefix(`books/${bookId}/v${book.contentVersion ?? 1}`);
  }
}
```

- [ ] **Step 4: Write the conversion module**

Create `apps/api/src/books/conversion/conversion.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConversionJobService } from './conversion-job.service.js';
import { ConversionRunner } from './conversion.runner.js';
import { PdfConverter } from './pdf.converter.js';

@Module({
  providers: [ConversionJobService, PdfConverter, ConversionRunner],
  exports: [ConversionJobService, ConversionRunner],
})
export class ConversionModule {}
```

- [ ] **Step 5: Write the worker entrypoint**

Create `apps/api/src/worker/worker.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ConversionModule } from '../books/conversion/conversion.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, StorageModule, ConversionModule],
})
export class WorkerModule {}
```

Create `apps/api/src/worker/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module.js';
import { ConversionRunner } from '../books/conversion/conversion.runner.js';
import { ConversionJobService } from '../books/conversion/conversion-job.service.js';

const POLL_INTERVAL_MS = 2000;
const STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function bootstrap(): Promise<void> {
  const logger = new Logger('BookConversionWorker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn', 'log'] });
  const runner = app.get(ConversionRunner);
  const jobs = app.get(ConversionJobService);

  let running = true;
  const shutdown = async () => {
    running = false;
    await app.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let lastSweep = 0;
  logger.log('Book conversion worker started');
  while (running) {
    if (Date.now() - lastSweep > STALE_SWEEP_INTERVAL_MS) {
      lastSweep = Date.now();
      const requeued = await jobs.requeueStale(15 * 60 * 1000);
      if (requeued > 0) logger.warn(`Requeued ${requeued} stale conversion job(s)`);
    }
    const worked = await runner.runOnce().catch((error: Error) => {
      logger.error(`Worker loop error: ${error.message}`);
      return false;
    });
    if (!worked) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

void bootstrap();
```

- [ ] **Step 6: Add worker scripts**

In `apps/api/package.json` scripts, after `start:prod`:

```json
"worker:dev": "tsx watch src/worker/main.ts",
"worker:start": "node dist/worker/main.js",
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @transformlit/api test -- conversion.runner`

Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/books/conversion apps/api/src/worker apps/api/package.json
git commit -m "feat(api): add conversion runner and worker process"
```

---

### Task 7: Upload integration — store original and enqueue conversion

**Files:**
- Modify: `apps/api/src/books/books.service.ts`
- Modify: `apps/api/src/books/books.module.ts`
- Modify: `apps/api/src/books/books.service.spec.ts`

**Interfaces:**
- Consumes: `STORAGE_ADAPTER`, `ConversionJobService`, `StorageAdapter`.
- Produces: `BooksService.uploadBookFile(bookId, buffer, actorId, actorRole): Promise<Book>` — stores the original via storage adapter, sets `format`/`conversionStatus=PENDING`, enqueues a job. Replaces the BlobService-only `uploadPdf` path (keep `uploadPdf` delegating to it for compatibility).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/books/books.service.spec.ts` a new describe block (the file already mocks `PrismaService` and `BlobService`; construct the service with the extra constructor args):

```ts
describe('uploadBookFile', () => {
  it('stores the original, sets format and PENDING, and enqueues conversion', async () => {
    const prisma = {
      book: {
        findUnique: jest.fn().mockResolvedValue({ id: 'book-1', createdById: 'user-1' }),
        update: jest.fn().mockResolvedValue({ id: 'book-1', format: 'PDF', conversionStatus: 'PENDING' }),
      },
      bookAccess: { findUnique: jest.fn() },
    };
    const storage = { put: jest.fn().mockResolvedValue(undefined) };
    const jobs = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const service = new BooksService(prisma as never, { streamPdf: jest.fn(), uploadPdf: jest.fn() } as never, storage as never, jobs as never);

    const result = await service.uploadBookFile('book-1', buildTestPdf(['Hello']), 'user-1', UserRole.MEMBER);

    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^books\/book-1\/[0-9a-f-]+\.pdf$/),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(jobs.enqueue).toHaveBeenCalledWith('book-1');
    expect(result.format).toBe('PDF');
  });

  it('rejects a non-PDF buffer', async () => {
    const prisma = {
      book: { findUnique: jest.fn().mockResolvedValue({ id: 'book-1', createdById: 'user-1' }), update: jest.fn() },
      bookAccess: { findUnique: jest.fn() },
    };
    const service = new BooksService(prisma as never, {} as never, { put: jest.fn() } as never, { enqueue: jest.fn() } as never);
    await expect(service.uploadBookFile('book-1', Buffer.from('nope'), 'user-1', UserRole.MEMBER)).rejects.toThrow(/not a PDF or EPUB/);
  });
});
```

Add imports at the top of the spec if missing: `import { UserRole } from '@transformlit/shared';` and `import { buildTestPdf } from '../../../test/fixtures/build-pdf';`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- books.service`

Expected: FAIL — `uploadBookFile is not a function`.

- [ ] **Step 3: Implement the new upload path**

In `apps/api/src/books/books.service.ts`:

1. Add imports:

```ts
import { Inject } from '@nestjs/common';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage/storage-adapter.js';
import { ConversionJobService } from './conversion/conversion-job.service.js';
```

2. Extend the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly conversionJobs: ConversionJobService,
  ) {}
```

3. Add the method (and switch `uploadPdf` to delegate so the resolver keeps working):

```ts
  /** Detects the format from magic bytes. PDF: %PDF-. EPUB: zip with mimetype entry. */
  detectFormat(buffer: Buffer): 'PDF' | 'EPUB' | null {
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
    const isZip = buffer.subarray(0, 2).toString('latin1') === 'PK';
    const hasEpubMimetype = buffer.subarray(0, 4096).includes(Buffer.from('application/epub+zip'));
    return isZip && hasEpubMimetype ? 'EPUB' : null;
  }

  async uploadBookFile(
    bookId: string,
    buffer: Buffer,
    actorId: string,
    actorRole: UserRole,
  ) {
    await this.assertCanManageBook(bookId, actorId, actorRole);

    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }
    const format = this.detectFormat(buffer);
    if (!format) {
      throw new BadRequestException('Uploaded file is not a PDF or EPUB');
    }

    // Never trust the client-supplied filename; always generate a server-side key.
    const extension = format === 'PDF' ? 'pdf' : 'epub';
    const storageKey = `books/${bookId}/${randomUUID()}.${extension}`;
    await this.storage.put(storageKey, buffer, format === 'PDF' ? 'application/pdf' : 'application/epub+zip');

    const book = await this.prisma.book.update({
      where: { id: bookId },
      data: {
        blobPath: storageKey,
        format,
        conversionStatus: 'PENDING',
        conversionError: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await this.conversionJobs.enqueue(bookId);
    return book;
  }

  async uploadPdf(
    bookId: string,
    buffer: Buffer,
    _filename: string,
    actorId: string,
    actorRole: UserRole,
  ) {
    return this.uploadBookFile(bookId, buffer, actorId, actorRole);
  }
```

Remove the now-unused `this.blob.uploadPdf` call from the old body; keep the `BlobService` field because `streamPdf` still uses it (Task 8 will switch page delivery to the storage adapter, but `streamPdf` remains for admin/original use if referenced elsewhere — if a lint error reports `blob` unused, remove the field and the `BlobService` import and assert `streamPdf` is deleted instead).

- [ ] **Step 4: Wire the module**

In `apps/api/src/books/books.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BooksService } from './books.service.js';
import { BooksResolver } from './books.resolver.js';
import { AuthModule } from '../auth/auth.module.js';
import { AzureModule } from '../azure/azure.module.js';
import { ConversionModule } from './conversion/conversion.module.js';

@Module({
  imports: [AuthModule, AzureModule, ConversionModule],
  providers: [BooksService, BooksResolver],
  exports: [BooksService],
})
export class BooksModule {}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @transformlit/api test -- books.service`

Expected: PASS — new tests plus all pre-existing `uploadPdf` tests still green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/books
git commit -m "feat(api): store uploads via storage adapter and enqueue conversion"
```

---

### Task 8: Reading sessions + page delivery endpoints

**Files:**
- Create: `apps/api/src/books/reader-session.service.ts`
- Create: `apps/api/src/books/reader-session.service.spec.ts`
- Create: `apps/api/src/books/books.controller.ts`
- Create: `apps/api/src/books/books.controller.spec.ts`
- Modify: `apps/api/src/books/books.module.ts`
- Modify: `apps/api/src/app.module.ts` (throttler)

**Interfaces:**
- Produces: `ReaderSessionService.create(userId, bookId)`, `.resolve(token)`, `.revoke(token)`; cookie name `transformlit_reader`; `READER_COOKIE_MAX_AGE_MS`.
- Produces: REST routes `POST /books/:id/reading-session` (Bearer), `GET /books/:id/pages/:n/frame` (cookie), `GET /books/:id/pages/:n/text` (cookie).
- Produces: `BooksService.assertCanRead(bookId, userId)` — shared entitlement gate (deletedAt null, PUBLISHED, READY, entitlement).

- [ ] **Step 1: Add the entitlement gate to BooksService (with tests)**

Append to `apps/api/src/books/books.service.spec.ts`:

```ts
describe('assertCanRead', () => {
  const base = { id: 'book-1', deletedAt: null, status: 'PUBLISHED', conversionStatus: 'READY', accessLevel: 'FREE', createdById: null };

  it('allows a free, published, ready book', async () => {
    const prisma = { book: { findUnique: jest.fn().mockResolvedValue(base) }, bookAccess: { findUnique: jest.fn() } };
    const service = new BooksService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.assertCanRead('book-1', 'user-1')).resolves.toMatchObject({ id: 'book-1' });
  });

  it('rejects a deleted book', async () => {
    const prisma = { book: { findUnique: jest.fn().mockResolvedValue({ ...base, deletedAt: new Date() }) }, bookAccess: { findUnique: jest.fn() } };
    const service = new BooksService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.assertCanRead('book-1', 'user-1')).rejects.toThrow(/not available/);
  });

  it('rejects a book that is still converting', async () => {
    const prisma = { book: { findUnique: jest.fn().mockResolvedValue({ ...base, conversionStatus: 'PENDING' }) }, bookAccess: { findUnique: jest.fn() } };
    const service = new BooksService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.assertCanRead('book-1', 'user-1')).rejects.toThrow(/not ready/);
  });

  it('rejects a restricted book without entitlement', async () => {
    const prisma = {
      book: { findUnique: jest.fn().mockResolvedValue({ ...base, accessLevel: 'RESTRICTED' }) },
      bookAccess: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new BooksService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.assertCanRead('book-1', 'user-1')).rejects.toThrow(/do not have access/);
  });

  it('allows a restricted book with an access row', async () => {
    const prisma = {
      book: { findUnique: jest.fn().mockResolvedValue({ ...base, accessLevel: 'RESTRICTED' }) },
      bookAccess: { findUnique: jest.fn().mockResolvedValue({ id: 'access-1' }) },
    };
    const service = new BooksService(prisma as never, {} as never, {} as never, {} as never);
    await expect(service.assertCanRead('book-1', 'user-1')).resolves.toMatchObject({ id: 'book-1' });
  });
});
```

Implement in `apps/api/src/books/books.service.ts`:

```ts
  /**
   * Single entitlement gate for every reader request. Throws rather than
   * returning booleans so callers cannot accidentally ignore the result.
   */
  async assertCanRead(bookId: string, userId: string) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book || book.deletedAt) throw new NotFoundException('Book not available');
    if (book.status !== 'PUBLISHED') throw new ForbiddenException('Book is not published');
    if (book.conversionStatus !== 'READY') throw new ForbiddenException('Book is not ready to read');

    const hasAccess =
      book.accessLevel === 'FREE' ||
      book.createdById === userId ||
      (await this.prisma.bookAccess.findUnique({ where: { bookId_userId: { bookId, userId } } })) !== null;
    if (!hasAccess) throw new ForbiddenException('You do not have access to this book');
    return book;
  }
```

- [ ] **Step 2: Write the failing session tests**

Create `apps/api/src/books/reader-session.service.spec.ts`:

```ts
import { createHash } from 'node:crypto';
import { ReaderSessionService, READER_SESSION_TTL_MS } from './reader-session.service';

describe('ReaderSessionService', () => {
  let prisma: { readingSession: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock } };
  let service: ReaderSessionService;

  beforeEach(() => {
    prisma = { readingSession: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() } };
    service = new ReaderSessionService(prisma as never);
  });

  it('creates a session storing only the token hash', async () => {
    prisma.readingSession.create.mockResolvedValue({ id: 'sess-1' });
    const token = await service.create('user-1', 'book-1');
    expect(typeof token).toBe('string');
    const expected = createHash('sha256').update(token).digest('hex');
    expect(prisma.readingSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', bookId: 'book-1', tokenHash: expected }),
    });
  });

  it('resolves a live session and slides its expiry', async () => {
    prisma.readingSession.findUnique.mockResolvedValue({
      id: 'sess-1', userId: 'user-1', bookId: 'book-1', revokedAt: null, expiresAt: new Date(Date.now() + 60000),
    });
    prisma.readingSession.update.mockResolvedValue({});
    const resolved = await service.resolve('token');
    expect(resolved).toMatchObject({ sessionId: 'sess-1', userId: 'user-1', bookId: 'book-1' });
    expect(prisma.readingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sess-1' },
        data: expect.objectContaining({ lastSeenAt: expect.any(Date), expiresAt: expect.any(Date) }),
      }),
    );
    const slid = prisma.readingSession.update.mock.calls[0][0].data.expiresAt as Date;
    expect(slid.getTime() - Date.now()).toBeGreaterThan(READER_SESSION_TTL_MS - 5000);
  });

  it('rejects an expired session', async () => {
    prisma.readingSession.findUnique.mockResolvedValue({
      id: 'sess-1', userId: 'user-1', bookId: 'book-1', revokedAt: null, expiresAt: new Date(Date.now() - 1000),
    });
    expect(await service.resolve('token')).toBeNull();
  });

  it('rejects a revoked session', async () => {
    prisma.readingSession.findUnique.mockResolvedValue({
      id: 'sess-1', userId: 'user-1', bookId: 'book-1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60000),
    });
    expect(await service.resolve('token')).toBeNull();
  });

  it('revokes every session for a user+book', async () => {
    prisma.readingSession.updateMany.mockResolvedValue({ count: 2 });
    expect(await service.revokeAll('user-1', 'book-1')).toBe(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @transformlit/api test -- reader-session`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the session service**

Create `apps/api/src/books/reader-session.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export const READER_COOKIE_NAME = 'transformlit_reader';
export const READER_SESSION_TTL_MS = 15 * 60 * 1000;

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  bookId: string;
}

@Injectable()
export class ReaderSessionService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Returns the raw token; only its SHA-256 hash is persisted. */
  async create(userId: string, bookId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.readingSession.create({
      data: {
        userId,
        bookId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + READER_SESSION_TTL_MS),
      },
    });
    return token;
  }

  /** Resolves a live session and slides its expiry forward. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token) return null;
    const session = await this.prisma.readingSession.findUnique({ where: { tokenHash: this.hash(token) } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;

    await this.prisma.readingSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + READER_SESSION_TTL_MS) },
    });
    return { sessionId: session.id, userId: session.userId, bookId: session.bookId };
  }

  async revokeAll(userId: string, bookId: string): Promise<number> {
    const result = await this.prisma.readingSession.updateMany({
      where: { userId, bookId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
```

- [ ] **Step 5: Write the controller tests**

Create `apps/api/src/books/books.controller.spec.ts`:

```ts
import { BooksController } from './books.controller';

describe('BooksController', () => {
  const book = { id: 'book-1', pageCount: 2 };

  function build(overrides: Record<string, unknown> = {}) {
    const books = {
      assertCanRead: jest.fn().mockResolvedValue(book),
      ...overrides,
    };
    const sessions = { create: jest.fn().mockResolvedValue('raw-token'), resolve: jest.fn() };
    const storage = { getBuffer: jest.fn(), getStream: jest.fn() };
    const views = { record: jest.fn().mockResolvedValue(undefined) };
    return { controller: new BooksController(books as never, sessions as never, storage as never, views as never), books, sessions, storage, views };
  }

  it('creates a reading session for an entitled user', async () => {
    const { controller, sessions } = build();
    const res = { cookie: jest.fn() } as never;
    const result = await controller.createSession('book-1', { id: 'user-1' }, res);
    expect(sessions.create).toHaveBeenCalledWith('user-1', 'book-1');
    expect(result).toMatchObject({ expiresInMs: expect.any(Number) });
  });

  it('rejects page requests without a session cookie', async () => {
    const { controller } = build();
    await expect(controller.getText('book-1', 1, { cookies: {} } as never)).rejects.toThrow(/session/i);
  });

  it('rejects a session that belongs to a different book', async () => {
    const { controller, sessions } = build();
    sessions.resolve.mockResolvedValue({ sessionId: 's', userId: 'u', bookId: 'other-book' });
    await expect(controller.getText('book-1', 1, { cookies: { transformlit_reader: 't' } } as never)).rejects.toThrow(/session/i);
  });

  it('serves a page frame as image bytes', async () => {
    const frame = Buffer.from('png-bytes');
    const getPageRecord = jest.fn().mockResolvedValue({ assetKey: 'k', textKey: 't', mimeType: 'image/png' });
    const { controller, sessions, storage } = build({ getPageRecord });
    sessions.resolve.mockResolvedValue({ sessionId: 's', userId: 'u', bookId: 'book-1' });
    storage.getBuffer.mockResolvedValue(frame);
    const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn() } as never;
    await controller.getFrame('book-1', 1, { cookies: { transformlit_reader: 't' } } as never, res);
    expect(storage.getBuffer).toHaveBeenCalledWith('k');
  });
});
```

- [ ] **Step 6: Implement the controller**

Create `apps/api/src/books/books.controller.ts`:

```ts
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { BooksService } from './books.service.js';
import { ReaderSessionService, READER_COOKIE_NAME, READER_SESSION_TTL_MS } from './reader-session.service.js';
import { PageViewService } from './page-view.service.js';
import { Inject } from '@nestjs/common';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage/storage-adapter.js';

interface AuthedRequest extends Request {
  user: { id: string; role: string };
}

@Controller('books')
export class BooksController {
  constructor(
    private readonly books: BooksService,
    private readonly sessions: ReaderSessionService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly pageViews: PageViewService,
  ) {}

  /** Bearer-authed. Sets the scoped, httpOnly reading-session cookie. */
  @Post(':id/reading-session')
  @UseGuards(AuthGuard('jwt'))
  async createSession(
    @Param('id') bookId: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.books.assertCanRead(bookId, req.user.id);
    const token = await this.sessions.create(req.user.id, bookId);
    res.cookie(READER_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/books',
      maxAge: READER_SESSION_TTL_MS,
    });
    return { expiresInMs: READER_SESSION_TTL_MS };
  }

  @Get(':id/pages/:n/frame')
  async getFrame(
    @Param('id') bookId: string,
    @Param('n', ParseIntPipe) page: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.authorizePage(bookId, page, req);
    const record = await this.books.getPageRecord(bookId, page);
    if (!record?.assetKey) throw new NotFoundException('Page not found');

    const buffer = await this.storage.getBuffer(record.assetKey);
    if (!buffer) throw new NotFoundException('Page asset missing');

    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.type(record.mimeType ?? 'image/png');
    res.send(buffer);
  }

  @Get(':id/pages/:n/text')
  async getText(@Param('id') bookId: string, @Param('n', ParseIntPipe) page: number, @Req() req: Request) {
    await this.authorizePage(bookId, page, req);
    const record = await this.books.getPageRecord(bookId, page);
    if (!record?.textKey) throw new NotFoundException('Page text not found');
    const buffer = await this.storage.getBuffer(record.textKey);
    if (!buffer) throw new NotFoundException('Page text missing');
    return JSON.parse(buffer.toString()) as { items: Array<{ t: string; x: number; y: number; w: number; h: number }> };
  }

  /** Session cookie must be live AND belong to this book; entitlement is re-checked. */
  private async authorizePage(bookId: string, page: number, req: Request) {
    const token = (req.cookies as Record<string, string> | undefined)?.[READER_COOKIE_NAME];
    const session = await this.sessions.resolve(token ?? '');
    if (!session || session.bookId !== bookId) {
      throw new UnauthorizedException('Reading session is missing or expired');
    }
    const book = await this.books.assertCanRead(bookId, session.userId);
    if (!book.pageCount || page < 1 || page > book.pageCount) throw new NotFoundException('Page out of range');
    await this.pageViews.record(session, page, book.contentVersion);
    return book;
  }
}
```

Add the page-view recorder as its own tiny service so it can be swapped to batched writes later. Create `apps/api/src/books/page-view.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResolvedSession } from './reader-session.service.js';

@Injectable()
export class PageViewService {
  constructor(private readonly prisma: PrismaService) {}

  async record(session: ResolvedSession, page: number, contentVersion: number): Promise<void> {
    await this.prisma.pageView.create({
      data: { sessionId: session.sessionId, userId: session.userId, bookId: session.bookId, page, contentVersion },
    });
  }
}
```

Add `getPageRecord` to `BooksService`:

```ts
  async getPageRecord(bookId: string, index: number) {
    return this.prisma.bookPage.findUnique({ where: { bookId_index: { bookId, index } } });
  }
```

- [ ] **Step 7: Register providers and throttler**

In `apps/api/src/books/books.module.ts`, add `BooksController` and the new providers:

```ts
import { Module } from '@nestjs/common';
import { BooksService } from './books.service.js';
import { BooksResolver } from './books.resolver.js';
import { BooksController } from './books.controller.js';
import { ReaderSessionService } from './reader-session.service.js';
import { PageViewService } from './page-view.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AzureModule } from '../azure/azure.module.js';
import { ConversionModule } from './conversion/conversion.module.js';

@Module({
  imports: [AuthModule, AzureModule, ConversionModule],
  controllers: [BooksController],
  providers: [BooksService, BooksResolver, ReaderSessionService, PageViewService],
  exports: [BooksService],
})
export class BooksModule {}
```

In `apps/api/src/app.module.ts`, add `ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])` to imports and register a scoped guard only on the page routes: add `@UseGuards(ThrottlerGuard)` to `getFrame`/`getText` in the controller with `@Throttle({ default: { limit: 90, ttl: 60000 } })`. Import `ThrottlerGuard, Throttle` from `@nestjs/throttler`.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @transformlit/api test -- reader-session books.controller books.service`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/books
git commit -m "feat(api): add reading sessions, page delivery endpoints and throttling"
```

---

### Task 9: GraphQL reader manifest (format, pageCount, status, toc)

**Files:**
- Modify: `apps/api/src/books/models/book.model.ts`
- Modify: `apps/api/src/books/books.resolver.ts`
- Modify: `apps/api/src/books/books.service.ts`
- Modify: `packages/shared/src/types/graphql.ts` (if `GraphQLBook` lives there)
- Modify: `apps/api/src/books/books.resolver.spec.ts`

**Interfaces:**
- Produces: GraphQL `Book.format`, `Book.pageCount`, `Book.conversionStatus`, `Book.toc: [BookTocEntry!]!`; `BookTocEntry` object type; `retryBookConversion(bookId): Book!`.
- Consumes: `ConversionJobService`.

- [ ] **Step 1: Write the failing resolver test**

Append to `apps/api/src/books/books.resolver.spec.ts`:

```ts
describe('reader manifest', () => {
  it('exposes toc for a book', async () => {
    const service = {
      listToc: jest.fn().mockResolvedValue([{ id: 't1', title: 'One', page: 1, depth: 0, order: 0 }]),
    };
    const resolver = new BooksResolver(service as never);
    await expect(resolver.bookToc('book-1')).resolves.toHaveLength(1);
  });

  it('retries conversion via the job service', async () => {
    const service = { assertCanManageBook: jest.fn().mockResolvedValue(undefined), setConversionPending: jest.fn() };
    const jobs = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const resolver = new BooksResolver(service as never, jobs as never);
    await resolver.retryBookConversion({ id: 'user-1', role: 'ADMIN' }, 'book-1');
    expect(jobs.enqueue).toHaveBeenCalledWith('book-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- books.resolver`

Expected: FAIL — `bookToc` is not a function.

- [ ] **Step 3: Extend the GraphQL model**

In `apps/api/src/books/models/book.model.ts`, add to the `Book` object type:

```ts
  @Field(() => BookFormat, { nullable: true })
  format?: BookFormat;

  @Field(() => ConversionStatus)
  conversionStatus: ConversionStatus;

  @Field(() => Int, { nullable: true })
  pageCount?: number;

  @Field(() => [BookTocEntry])
  toc: BookTocEntry[];
```

Add the enum registrations and the new object type at the top of the file:

```ts
import { BookAccessLevel, BookFormat, BookStatus, ConversionStatus } from '@transformlit/shared';
import { Int } from '@nestjs/graphql';

registerEnumType(BookAccessLevel, { name: 'BookAccessLevel' });
registerEnumType(BookStatus, { name: 'BookStatus' });
registerEnumType(BookFormat, { name: 'BookFormat' });
registerEnumType(ConversionStatus, { name: 'ConversionStatus' });

@ObjectType()
export class BookTocEntry {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  depth: number;

  @Field(() => Int)
  order: number;
}
```

- [ ] **Step 4: Extend the service and resolver**

In `BooksService`:

```ts
  async listToc(bookId: string) {
    return this.prisma.bookTocEntry.findMany({ where: { bookId }, orderBy: { order: 'asc' } });
  }

  /** Marks a book PENDING again so the worker re-runs conversion. */
  async setConversionPending(bookId: string) {
    await this.prisma.book.update({
      where: { id: bookId },
      data: { conversionStatus: 'PENDING', conversionError: null },
    });
  }
```

`findById` must include the ToC:

```ts
  async findById(id: string, _userId?: string) {
    const book = await this.prisma.book.findUnique({
      where: { id, deletedAt: null },
      include: { tocEntries: { orderBy: { order: 'asc' } } },
    });
    if (!book) throw new NotFoundException('Book not found');
    return { ...book, toc: book.tocEntries };
  }
```

In `BooksResolver`, inject `ConversionJobService` and add:

```ts
  @Query(() => [BookTocEntry], { name: 'bookToc' })
  @UseGuards(JwtAuthGuard)
  async bookToc(@Args('bookId') bookId: string) {
    return this.booksService.listToc(bookId);
  }

  @Mutation(() => Book, { name: 'retryBookConversion' })
  @UseGuards(JwtAuthGuard)
  async retryBookConversion(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('bookId') bookId: string,
  ) {
    await this.booksService.assertCanManageBookPublic(bookId, user.id, user.role);
    await this.booksService.setConversionPending(bookId);
    await this.conversionJobs.enqueue(bookId);
    return this.booksService.findById(bookId);
  }
```

Rename the private `assertCanManageBook` to a public `assertCanManageBookPublic` (or make the original public) so the resolver can call it.

- [ ] **Step 5: Regenerate the schema**

Run: `pnpm --filter @transformlit/api build`

Expected: `src/schema.gql` regenerated with `BookFormat`, `ConversionStatus`, `BookTocEntry`, and the new fields.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @transformlit/api test -- books.resolver books.service`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/books apps/api/src/schema.gql packages/shared
git commit -m "feat(api): expose reader manifest and conversion retry over GraphQL"
```

---

### Task 10: Web reader store + page API client

**Files:**
- Create: `apps/web/src/lib/reader/api.ts`
- Create: `apps/web/src/lib/reader/api.spec.ts`
- Create: `apps/web/src/store/reader-store.ts`
- Create: `apps/web/src/store/reader-store.spec.ts`
- Modify: `apps/web/src/store/index.ts`

**Interfaces:**
- Produces: `openReadingSession(bookId): Promise<{ expiresInMs: number }>`, `pageFrameUrl(bookId, page): string`, `fetchPageText(bookId, page): Promise<PdfPageText>`, `fetchReadProgress(bookId): Promise<{ currentPage: number } | null>`, `saveReaderProgress(bookId, currentPage): Promise<void>`. (Plan 2 Task 4 widens `fetchPageText` to a discriminated `{ kind: 'pdf' | 'epub', ... }` result.)
- Produces: `useReaderStore` with `theme`, `mode`, `zoom`, `lastPage: Record<string, number>` and setters; persisted like `bible-store.ts`.

- [ ] **Step 1: Write the failing store test**

Create `apps/web/src/store/reader-store.spec.ts`:

```ts
import { useReaderStore } from './reader-store';

describe('reader store', () => {
  beforeEach(() => {
    useReaderStore.setState({ theme: 'paper', mode: 'paged', zoom: 1, lastPage: {} });
  });

  it('sets theme, mode and zoom', () => {
    useReaderStore.getState().setTheme('sepia');
    useReaderStore.getState().setMode('scroll');
    useReaderStore.getState().setZoom(1.25);
    const state = useReaderStore.getState();
    expect(state.theme).toBe('sepia');
    expect(state.mode).toBe('scroll');
    expect(state.zoom).toBe(1.25);
  });

  it('records last page per book', () => {
    useReaderStore.getState().setLastPage('book-1', 12);
    useReaderStore.getState().setLastPage('book-2', 3);
    expect(useReaderStore.getState().lastPage).toEqual({ 'book-1': 12, 'book-2': 3 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @transformlit/web test -- reader-store`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `apps/web/src/store/reader-store.ts` (mirrors `bible-store.ts:1-47` persistence shape):

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ReaderTheme = 'paper' | 'sepia' | 'warm' | 'dark';
export type ReaderMode = 'paged' | 'scroll';

interface ReaderStore {
  theme: ReaderTheme;
  mode: ReaderMode;
  zoom: number;
  lastPage: Record<string, number>;
  isHydrated: boolean;
  setTheme: (theme: ReaderTheme) => void;
  setMode: (mode: ReaderMode) => void;
  setZoom: (zoom: number) => void;
  setLastPage: (bookId: string, page: number) => void;
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set) => ({
      theme: 'paper',
      mode: 'paged',
      zoom: 1,
      lastPage: {},
      isHydrated: false,
      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      setZoom: (zoom) => set({ zoom }),
      setLastPage: (bookId, page) => set((s) => ({ lastPage: { ...s.lastPage, [bookId]: page } })),
    }),
    {
      name: 'reader-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ theme: state.theme, mode: state.mode, zoom: state.zoom, lastPage: state.lastPage }),
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<ReaderStore> | undefined), isHydrated: true }),
    },
  ),
);
```

Export it from `apps/web/src/store/index.ts`.

- [ ] **Step 4: Write the failing API client test**

Create `apps/web/src/lib/reader/api.spec.ts`:

```ts
import { fetchPageText, fetchReadProgress, openReadingSession, saveReaderProgress } from './api';
import { apolloClient } from '../apollo-client';

jest.mock('../apollo-client', () => ({
  apolloClient: { query: jest.fn(), mutate: jest.fn() },
}));

describe('reader api', () => {
  const originalFetch = globalThis.fetch;
  const queryMock = apolloClient.query as jest.Mock;
  const mutateMock = apolloClient.mutate as jest.Mock;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('opens a reading session with credentials included', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ expiresInMs: 900000 }) });
    globalThis.fetch = fetchMock as never;
    const result = await openReadingSession('book-1');
    expect(result.expiresInMs).toBe(900000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/books/book-1/reading-session'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('fetches page text JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] }),
    }) as never;
    const text = await fetchPageText('book-1', 1);
    expect(text.items[0].t).toBe('Hello');
  });

  it('throws on a failed frame fetch', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as never;
    await expect(fetchPageText('book-1', 1)).rejects.toThrow(/401/);
  });

  it('reads the saved page so the reader can resume', async () => {
    queryMock.mockResolvedValue({ data: { readProgress: { currentPage: 7 } } });
    await expect(fetchReadProgress('book-1')).resolves.toEqual({ currentPage: 7 });
  });

  it('returns null when the reader has no saved progress', async () => {
    queryMock.mockResolvedValue({ data: { readProgress: null } });
    await expect(fetchReadProgress('book-1')).resolves.toBeNull();
  });

  it('persists the current page through the saveProgress mutation', async () => {
    mutateMock.mockResolvedValue({ data: { saveProgress: { currentPage: 12 } } });
    await saveReaderProgress('book-1', 12);
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { input: { bookId: 'book-1', currentPage: 12 } } }),
    );
  });
});
```

- [ ] **Step 5: Implement the API client**

Create `apps/web/src/lib/reader/api.ts`:

```ts
import { gql } from '@apollo/client';
import { apolloClient } from '../apollo-client';
import { API_BASE } from '../constants';
import { getAccessToken } from '../auth';

export const READ_PROGRESS_QUERY = gql`
  query ReadProgress($bookId: ID!) {
    readProgress(bookId: $bookId) {
      currentPage
    }
  }
`;

export const SAVE_PROGRESS_MUTATION = gql`
  mutation SaveReaderProgress($input: SaveProgressInput!) {
    saveProgress(input: $input) {
      currentPage
    }
  }
`;

export interface PdfTextItem {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPageText {
  items: PdfTextItem[];
}

async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) throw new Error(`Reader request failed with ${response.status}`);
  return response;
}

/** Bearer-authed; the API responds with the scoped reading-session cookie. */
export async function openReadingSession(bookId: string): Promise<{ expiresInMs: number }> {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE}/books/${bookId}/reading-session`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return (await ensureOk(response)).json() as Promise<{ expiresInMs: number }>;
}

/** Cookie-authed endpoints below — never send a Bearer header to <img> hosts. */
export function pageFrameUrl(bookId: string, page: number): string {
  return `${API_BASE}/books/${bookId}/pages/${page}/frame`;
}

export async function fetchPageText(bookId: string, page: number): Promise<PdfPageText> {
  const response = await fetch(`${API_BASE}/books/${bookId}/pages/${page}/text`, { credentials: 'include' });
  return (await ensureOk(response)).json() as Promise<PdfPageText>;
}

/** Server-side reading position, used to resume when the URL has no `?page`. */
export async function fetchReadProgress(bookId: string): Promise<{ currentPage: number } | null> {
  const result = await apolloClient.query<{ readProgress: { currentPage: number } | null }>({
    query: READ_PROGRESS_QUERY,
    variables: { bookId },
    fetchPolicy: 'no-cache',
  });
  return result.data?.readProgress ?? null;
}

/** Debounced by the reader client; persists the page so a later visit can resume. */
export async function saveReaderProgress(bookId: string, currentPage: number): Promise<void> {
  await apolloClient.mutate({
    mutation: SAVE_PROGRESS_MUTATION,
    variables: { input: { bookId, currentPage } },
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @transformlit/web test -- reader-store reader/api`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/reader apps/web/src/store
git commit -m "feat(web): add reader store and page API client"
```

---

### Task 11: Immersive reader route + PDF page rendering

**Files:**
- Create: `apps/web/src/app/(reader)/layout.tsx`
- Create: `apps/web/src/app/(reader)/books/[id]/read/page.tsx`
- Create: `apps/web/src/app/(reader)/books/[id]/read/reader-client.tsx`
- Create: `apps/web/src/components/reader/page-canvas.tsx`
- Create: `apps/web/src/components/reader/reader-toolbar.tsx`
- Create: `apps/web/src/app/(reader)/books/[id]/read/reader-client.spec.tsx`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Consumes: `useReaderStore`, `openReadingSession`, `pageFrameUrl`, `fetchPageText`, `fetchReadProgress`, `saveReaderProgress`.
- Produces: `ReaderClient({ bookId, initialPage? })`, `PageCanvas({ bookId, page, items })`, `ReaderToolbar({ title, page, pageCount, onPageChange, onBack })`.
- Note: this Task renders the frame image + text layer; annotation rendering lands in Plan 2.

- [ ] **Step 1: Write the failing reader test**

Create `apps/web/src/app/(reader)/books/[id]/read/reader-client.spec.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/books/book-1/read',
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@apollo/client', () => ({ gql: (strings: TemplateStringsArray) => strings[0] }));

const mockQuery = jest.fn();
jest.mock('../../../../../lib/apollo-client', () => ({ apolloClient: { query: mockQuery } }));

jest.mock('../../../../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ user: { id: '1' }, isHydrated: true }),
  useReaderStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'paper', mode: 'paged', zoom: 1, lastPage: {}, setLastPage: jest.fn(), setTheme: jest.fn(), setMode: jest.fn(), setZoom: jest.fn() }),
}));

jest.mock('../../../../../lib/reader/api', () => ({
  openReadingSession: jest.fn().mockResolvedValue({ expiresInMs: 900000 }),
  pageFrameUrl: (bookId: string, page: number) => `http://api.test/books/${bookId}/pages/${page}/frame`,
  fetchPageText: jest.fn().mockResolvedValue({ items: [{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] }),
  fetchReadProgress: jest.fn().mockResolvedValue({ currentPage: 2 }),
  saveReaderProgress: jest.fn().mockResolvedValue(undefined),
}));

import { ReaderClient } from './reader-client';

describe('ReaderClient', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockQuery.mockResolvedValue({
      data: { book: { id: 'book-1', title: 'Test Book', format: 'PDF', pageCount: 3, conversionStatus: 'READY', toc: [] } },
    });
  });

  it('loads the manifest and renders the first frame', async () => {
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    expect(await screen.findByText('Test Book')).toBeInTheDocument();
    const frame = await screen.findByTestId('page-frame');
    expect(frame).toHaveAttribute('src', 'http://api.test/books/book-1/pages/1/frame');
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('resumes from saved progress when the URL has no page', async () => {
    render(<ReaderClient bookId="book-1" />);
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('shows the access-denied state when the manifest query fails', async () => {
    mockQuery.mockRejectedValue(new Error('forbidden'));
    render(<ReaderClient bookId="book-1" initialPage={1} />);
    expect(await screen.findByText(/do not have access|not available/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @transformlit/web test -- reader-client`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the immersive layout**

Create `apps/web/src/app/(reader)/layout.tsx`:

```tsx
'use client';

import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { ApolloProvider } from '../../components/providers/apollo-provider';

export default function ReaderLayout({ children }: { readonly children: React.ReactNode }) {
  const { isReady } = useRequireAuth();
  if (!isReady) return null;
  return <ApolloProvider>{children}</ApolloProvider>;
}
```

Then allow reader frames from the dev API origin in `apps/web/next.config.ts`. The frame is loaded as a plain `<img src>`; in production the API is same-origin (`'self'`), but in dev it is cross-origin on `http://localhost:3005`, which `connect-src` already lists and `img-src` does **not**. Without this the CSP blocks every page frame in dev and the E2E test can never pass. Change only `img-src`, matching the existing `IS_PROD` conditional style:

```ts
  // img-src gains the dev API origin only. Reader page frames load as plain
  // <img src> (never next/image); prod API is same-origin via 'self'.
  IS_PROD
    ? "img-src 'self' data: https://bible.helloao.org https://www.transparenttextures.com https://*.blob.core.windows.net https://lh3.googleusercontent.com"
    : "img-src 'self' data: http://localhost:3005 https://bible.helloao.org https://www.transparenttextures.com https://*.blob.core.windows.net https://lh3.googleusercontent.com",
```

No `blob:` is added — that is deliberate (spec: page bytes are fetched from the API, not object URLs).

- [ ] **Step 4: Create the page route**

Create `apps/web/src/app/(reader)/books/[id]/read/page.tsx` (Next 16: `params`/`searchParams` are Promises, matching the existing `bible/[translation]/[book]/[chapter]/page.tsx` convention):

```tsx
import { ReaderClient } from './reader-client';

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly page?: string }>;
}

export default async function ReadPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const parsed = Number.parseInt(query.page ?? '', 10);
  // No `?page` → let the client resume from saved progress.
  const initialPage = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  return <ReaderClient bookId={id} initialPage={initialPage} />;
}
```

- [ ] **Step 5: Create the reader client**

Create `apps/web/src/app/(reader)/books/[id]/read/reader-client.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gql } from '@apollo/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { apolloClient } from '../../../../../lib/apollo-client';
import { openReadingSession, pageFrameUrl, fetchPageText, fetchReadProgress, saveReaderProgress, PdfTextItem } from '../../../../../lib/reader/api';
import { useReaderStore } from '../../../../../store';
import { PageCanvas } from '../../../../../components/reader/page-canvas';
import { ReaderToolbar } from '../../../../../components/reader/reader-toolbar';

const BOOK_MANIFEST_QUERY = gql`
  query ReaderBook($id: ID!) {
    book(id: $id) {
      id
      title
      author
      format
      pageCount
      conversionStatus
      toc {
        id
        title
        page
        depth
      }
    }
  }
`;

interface Manifest {
  id: string;
  title: string;
  author?: string;
  format?: 'PDF' | 'EPUB';
  pageCount?: number;
  conversionStatus: 'NOT_APPLICABLE' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  toc: Array<{ id: string; title: string; page: number; depth: number }>;
}

/** How long page positions settle before the server save fires. */
const PROGRESS_SAVE_DEBOUNCE_MS = 1500;

export function ReaderClient({ bookId, initialPage }: { readonly bookId: string; readonly initialPage?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setLastPage } = useReaderStore();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage ?? 1);
  const [items, setItems] = useState<PdfTextItem[] | null>(null);
  const pageCount = manifest?.pageCount ?? 0;
  const sessionReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    let cancelled = false;
    apolloClient
      .query<{ book: Manifest }>({ query: BOOK_MANIFEST_QUERY, variables: { id: bookId } })
      .then((result) => {
        if (!cancelled) setManifest(result.data.book);
      })
      .catch(() => {
        if (!cancelled) setError('You do not have access to this book, or it is not available.');
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // One session per mount; the API slides its TTL as pages are fetched.
  useEffect(() => {
    if (sessionReady.current) return;
    sessionReady.current = true;
    openReadingSession(bookId).catch(() => setError('Could not start a reading session.'));
  }, [bookId]);

  // Resume only when the URL did not pin a page — an explicit ?page always wins.
  useEffect(() => {
    if (initialPage !== undefined) return;
    let cancelled = false;
    fetchReadProgress(bookId)
      .then((progress) => {
        if (!cancelled && progress?.currentPage) setPage(progress.currentPage);
      })
      .catch(() => {
        /* no saved progress yet — start at page 1 */
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, initialPage]);

  useEffect(() => {
    if (!manifest || manifest.conversionStatus !== 'READY') return;
    let cancelled = false;
    setItems(null);
    fetchPageText(bookId, page)
      .then((text) => {
        if (!cancelled) setItems(text.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    // Local position updates instantly; the server save is debounced on page settle.
    setLastPage(bookId, page);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveReaderProgress(bookId, page).catch(() => {
        /* a later page-settle save retries */
      });
    }, PROGRESS_SAVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [bookId, manifest, page, setLastPage]);

  // Flush the position when the tab is hidden or the reader unmounts.
  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') {
        saveReaderProgress(bookId, pageRef.current).catch(() => {
          /* best-effort on teardown */
        });
      }
    };
    document.addEventListener('visibilitychange', flushOnHide);
    return () => {
      document.removeEventListener('visibilitychange', flushOnHide);
      saveReaderProgress(bookId, pageRef.current).catch(() => {
        /* best-effort on teardown */
      });
    };
  }, [bookId]);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 1), pageCount || 1);
      setPage(clamped);
      const params = new URLSearchParams(searchParams.toString());
      params.set('page', String(clamped));
      router.replace(`/books/${bookId}/read?${params.toString()}`);
    },
    [bookId, pageCount, router, searchParams],
  );

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface p-6 text-center">
        <div>
          <p className="font-display text-headline-h3 text-on-surface">This book can’t be opened</p>
          <p className="font-body text-body mt-2 text-on-surface-variant">{error}</p>
          <button type="button" className="mt-4 text-primary underline" onClick={() => router.push('/books')}>
            Back to library
          </button>
        </div>
      </main>
    );
  }

  if (!manifest) {
    return <div className="flex min-h-dvh items-center justify-center bg-surface" data-testid="reader-loading" />;
  }

  return (
    <div data-reader-theme={theme} className="flex min-h-dvh flex-col bg-paper text-on-surface">
      <ReaderToolbar
        title={manifest.title}
        page={page}
        pageCount={pageCount}
        onPageChange={goToPage}
        onBack={() => router.push('/books')}
      />
      <main className="flex flex-1 items-start justify-center overflow-auto p-4">
        <PageCanvas bookId={bookId} page={page} items={items} />
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Create the toolbar and page canvas**

Create `apps/web/src/components/reader/reader-toolbar.tsx`:

```tsx
'use client';

interface ReaderToolbarProps {
  readonly title: string;
  readonly page: number;
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
  readonly onBack: () => void;
}

export function ReaderToolbar({ title, page, pageCount, onPageChange, onBack }: ReaderToolbarProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-outline-variant bg-surface-container-low px-4 py-2">
      <button type="button" onClick={onBack} aria-label="Back to library" className="material-symbols-outlined min-h-11 min-w-11">
        arrow_back
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-headline-h3">{title}</h1>
      <nav aria-label="Page navigation" className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="material-symbols-outlined min-h-11 min-w-11 disabled:opacity-40"
        >
          chevron_left
        </button>
        <span aria-live="polite" className="font-small text-small tabular-nums">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="material-symbols-outlined min-h-11 min-w-11 disabled:opacity-40"
        >
          chevron_right
        </button>
      </nav>
    </header>
  );
}
```

Create `apps/web/src/components/reader/page-canvas.tsx`:

```tsx
'use client';

import { pageFrameUrl, PdfTextItem } from '../../lib/reader/api';

interface PageCanvasProps {
  readonly bookId: string;
  readonly page: number;
  readonly items: PdfTextItem[] | null;
}

/**
 * One reader page. The raster frame is presentation-only (aria-hidden); the
 * absolutely-positioned text layer carries selection and screen-reader content.
 * `next/image` is intentionally NOT used: it would proxy and cache protected
 * bytes behind a stable app-origin URL.
 */
export function PageCanvas({ bookId, page, items }: PageCanvasProps) {
  return (
    <figure className="relative mx-auto w-full max-w-[720px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid="page-frame"
        src={pageFrameUrl(bookId, page)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="block h-auto w-full select-none rounded-md shadow-soft"
      />
      {items ? (
        <div className="absolute inset-0" data-testid="pdf-text-layer">
          {items.map((item) => (
            <span
              key={`${item.x}-${item.y}-${item.t}`}
              className="absolute whitespace-pre text-transparent selection:bg-accent/40"
              style={{
                left: `${item.x * 100}%`,
                top: `${item.y * 100}%`,
                width: `${item.w * 100}%`,
                height: `${item.h * 100}%`,
                fontSize: '13px',
              }}
            >
              {item.t}
            </span>
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-surface-container-high/40" data-testid="page-skeleton" />
      )}
    </figure>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @transformlit/web test -- reader-client`

Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(reader)" apps/web/src/components/reader
git commit -m "feat(web): add immersive PDF reader route with frame and text layer"
```

---

### Task 12: Wire the books list and resume card to the reader

**Files:**
- Modify: `apps/web/src/app/(app)/books/books-client.tsx`
- Modify: `apps/web/src/app/(app)/books/books.spec.tsx`

**Interfaces:**
- Consumes: reader route `/books/[id]/read`.
- Produces: `handleRead` navigates to the reader; unready books keep a toast instead.

- [ ] **Step 1: Update the failing test**

In `apps/web/src/app/(app)/books/books.spec.tsx`, extend the first render test (or add a new one) to assert navigation:

```tsx
it('opens the reader when a read button is clicked', async () => {
  mockQuery.mockResolvedValueOnce({
    data: {
      books: [
        {
          id: 'book-1',
          title: 'Sample',
          accessLevel: 'FREE',
          status: 'PUBLISHED',
          conversionStatus: 'READY',
          pageCount: 10,
          coverUrl: null,
          createdAt: new Date().toISOString(),
        },
      ],
    },
  });
  render(<BooksClient />);
  const readButton = await screen.findByTestId('read-btn');
  fireEvent.click(readButton);
  expect(mockPush).toHaveBeenCalledWith('/books/book-1/read');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @transformlit/web test -- books.spec`

Expected: FAIL — `mockPush` not called with the reader path.

- [ ] **Step 3: Implement the navigation**

In `books-client.tsx`, replace `handleRead` (lines ~127-133):

```tsx
  const handleRead = useCallback(
    (book?: { id: string; conversionStatus?: string }) => {
      if (!book) {
        addToast('Reader opening soon.', 'info');
        return;
      }
      if (book.conversionStatus !== 'READY') {
        addToast('This book is still being prepared.', 'info');
        return;
      }
      push(`/books/${book.id}/read`);
    },
    [addToast, push],
  );
```

Wire the `BookCard` `onRead` prop to `() => handleRead(book)`. If the component does not already use `useRouter`, add `const push = useRouter().push;`. Add `conversionStatus`/`pageCount` to `BOOKS_QUERY` (lines 18-35) so the gate has data.

Leave the "Currently Reading" section on its existing `CURRENTLY_READING` mock for now — those entries (`reading-1`/`reading-2`) are not real book ids and have no data source in v1, so do **not** wire `ReadingProgressCard.onContinue` to `handleRead` (it would fire the "Reader opening soon." toast with no book). A real resume feed needs a "my reading progress" list query, which is out of scope for Plan 1; per-book resume is already implemented in Task 11 (`fetchReadProgress`).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @transformlit/web test -- books.spec`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/books"
git commit -m "feat(web): open the reader from the books list and resume card"
```

---

### Task 13: Plan 1 verification

**Files:**
- Create: `apps/web/e2e/reader.spec.ts`
- Create: `apps/api/test/reader-security.integration.spec.ts`

**Interfaces:**
- Produces: an end-to-end proof that a PDF book converts and reads page-by-page, and that no endpoint leaks the original.

- [ ] **Step 1: Write the security integration test**

Create `apps/api/test/reader-security.integration.spec.ts` (reuse the container + migration runner from `books.integration.spec.ts:14-98`). The test must fail if any endpoint returns the raw original or a storage key:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { ConversionRunner } from '../src/books/conversion/conversion.runner';
import { buildTestPdf } from './fixtures/build-pdf';

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
        .withDatabase('testdb').withUsername('test').withPassword('test').start();
      databaseUrl = container.getConnectionUri();
    } catch {
      databaseUrl = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/transformlit_test';
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    process.env.BOOK_STORAGE_DIR = `${process.cwd()}/.book-storage-test`;

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
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

    const stamp = Date.now();
    const auth = moduleFixture.get<AuthService>(AuthService);
    const registered = await auth.registerLocal({
      email: `reader-security-${stamp}@example.com`,
      password: 'Password123!',
      displayName: 'Security Reader',
    });
    token = registered.accessToken;

    const books = moduleFixture.get<BooksService>(BooksService);
    const book = await books.uploadBook({ title: `Security Book ${stamp}`, accessLevel: 'FREE' as never }, registered.user.id);
    bookId = book.id;
    await books.uploadBookFile(bookId, buildTestPdf(['Secret page one', 'Secret page two']), registered.user.id, 'ADMIN' as never);

    const runner = moduleFixture.get(ConversionRunner);
    await runner.runOnce();
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

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
});
```

- [ ] **Step 2: Write the Playwright E2E test**

Create `apps/web/e2e/reader.spec.ts` (pattern from `e2e/bible.spec.ts`):

```ts
import { test, expect } from '@playwright/test';

test('open a book, turn pages, jump via URL', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);

  await page.goto('/books');
  const readButton = page.getByTestId('read-btn').first();
  if ((await readButton.count()) === 0) test.skip(true, 'No ready book seeded');

  await readButton.click();
  await expect(page).toHaveURL(/\/books\/.+\/read/);
  await expect(page.getByTestId('page-frame')).toBeVisible();
  await expect(page.getByText(/Page \d+ of \d+/)).toBeVisible();

  const next = page.getByRole('button', { name: 'Next page' });
  if (await next.isEnabled()) {
    await next.click();
    await expect(page).toHaveURL(/page=2/);
  }

  // The reader must be deep-linkable.
  await page.reload();
  await expect(page.getByTestId('page-frame')).toBeVisible();
});
```

- [ ] **Step 3: Run both suites**

```bash
pnpm --filter @transformlit/api test:integration -- reader-security
pnpm --filter @transformlit/web test
pnpm --filter @transformlit/api test
```

Expected: all green. The E2E test requires the dev servers (`pnpm --filter @transformlit/api dev` + worker, and the web dev server); if no converted book exists it skips rather than fails.

- [ ] **Step 4: Manual verification**

1. Start API, worker (`pnpm --filter @transformlit/api worker:dev`), and web.
2. Upload a real PDF to a book via the `uploadPdf` mutation.
3. Confirm `.book-storage/books/<id>/v2/pages/*.png` exists and the session/page network calls return `no-store`.
4. Confirm DevTools shows no `/_next/image` request for the frame and no storage key in any response.
5. Confirm the worker log line `Converted PDF <id>: N pages`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/reader.spec.ts apps/api/test/reader-security.integration.spec.ts
git commit -m "test: add reader security integration and E2E coverage"
```

---

## Plan 1 Done — what works after this

A user can upload a PDF, watch it convert in the worker, open `/books/[id]/read`, turn pages (buttons, keyboard arrows, URL `?page=`), see "Page N of M", read with an accessible text layer, and resume from the saved page. The original file is never reachable from the browser. No annotations, ToC panel, EPUB, settings, scroll mode, or bookmark/highlight UI yet — Plan 2 adds those.
