import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { LocalStorageAdapter } from '../../src/storage/local-storage.adapter.js';

export interface PwaFixturePlan {
  ownerId: string;
  accounts: readonly { id: string; email: string; displayName: string }[];
  credentials: readonly { email: string; password: string }[];
  books: {
    readable: { id: string; title: string; pages: readonly { index: number; text: string }[]; contentVersions: readonly number[] };
    restricted: { id: string; title: string; restricted: true };
    publicationChangeDuringDownload: { initialVersion: 1; publishedVersion: 2; hook: 'pwa-harness.ts publish-v2' };
  };
}

export function createPwaFixturePlan(ownerId: string): PwaFixturePlan {
  const readerEmail = `pwa-reader-${ownerId}@example.test`;
  const outsiderEmail = `pwa-outsider-${ownerId}@example.test`;
  return {
    ownerId,
    accounts: [
      { id: randomUUID(), email: readerEmail, displayName: 'PWA Reader' },
      { id: randomUUID(), email: outsiderEmail, displayName: 'PWA Outsider' },
    ],
    credentials: [
      { email: readerEmail, password: randomBytes(32).toString('base64url') },
      { email: outsiderEmail, password: randomBytes(32).toString('base64url') },
    ],
    books: {
      readable: {
        id: randomUUID(),
        title: `PWA multi-page fixture ${ownerId}`,
        pages: [1, 2, 3].map((index) => ({ index, text: `Fixture page ${index}` })),
        contentVersions: [1, 2],
      },
      restricted: { id: randomUUID(), title: 'PWA restricted fixture', restricted: true },
      publicationChangeDuringDownload: { initialVersion: 1, publishedVersion: 2, hook: 'pwa-harness.ts publish-v2' },
    },
  };
}

const fixturePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII=', 'base64');

function checksum(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (-(value & 1) & 0xedb88320);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function createPwaFramePayload(version: 1 | 2): Buffer {
  if (version === 1) return Buffer.from(fixturePng);
  const type = Buffer.from('tEXt');
  const text = Buffer.from('Comment\0PWA publication version 2');
  const chunkData = Buffer.concat([type, text]);
  const chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length, 0);
  type.copy(chunk, 4);
  text.copy(chunk, 8);
  chunk.writeUInt32BE(checksum(chunkData), text.length + 8);
  return Buffer.concat([fixturePng.subarray(0, fixturePng.length - 12), chunk, fixturePng.subarray(fixturePng.length - 12)]);
}

/** Database and asset writes require Task 1A's live container and this invocation's storage root. */
export async function seedPwaFixtures(
  databaseUrl: string | undefined,
  container: import('@testcontainers/postgresql').StartedPostgreSqlContainer | null | undefined,
  storageDir: string,
  ownerId: string,
): Promise<PwaFixturePlan> {
  const { assertOwnedDisposableDatabaseUrl } = await import('./pwa-disposable-db.js');
  const assertOwned: (url: string | undefined, owner: typeof container) => asserts url is string = assertOwnedDisposableDatabaseUrl;
  assertOwned(databaseUrl, container);
  const plan = createPwaFixturePlan(ownerId);
  const storage = new LocalStorageAdapter(storageDir);
  const frameV1 = createPwaFramePayload(1);
  await Promise.all(plan.books.readable.pages.map(async (page) => {
    await storage.put(`books/${plan.books.readable.id}/v1/page-${page.index}.png`, frameV1, 'image/png');
    await storage.put(`books/${plan.books.readable.id}/v1/page-${page.index}.txt`, Buffer.from(page.text), 'text/plain');
  }));
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('@prisma/client'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const users = await Promise.all(plan.accounts.map(async (account, index) => prisma.user.create({
      data: {
        id: account.id,
        email: account.email,
        emailNormalized: account.email,
        displayName: account.displayName,
        passwordHash: await argon2.hash(plan.credentials[index].password),
      },
    })));
    const [reader] = users;
    const book = await prisma.book.create({
      data: {
        id: plan.books.readable.id,
        title: plan.books.readable.title,
        status: 'PUBLISHED',
        accessLevel: 'FREE',
        conversionStatus: 'READY',
        totalPages: plan.books.readable.pages.length,
        pageCount: plan.books.readable.pages.length,
        contentVersion: 1,
        createdById: reader.id,
        publishedAt: new Date(),
        pages: { create: plan.books.readable.pages.map((page) => ({ index: page.index, assetKey: `books/${plan.books.readable.id}/v1/page-${page.index}.png`, textKey: `books/${plan.books.readable.id}/v1/page-${page.index}.txt`, mimeType: 'image/png', width: 1, height: 1, charCount: page.text.length })) },
      },
    });
    await prisma.book.create({
      data: {
        id: plan.books.restricted.id,
        title: plan.books.restricted.title,
        status: 'PUBLISHED',
        accessLevel: 'RESTRICTED',
        conversionStatus: 'READY',
        totalPages: 1,
        createdById: reader.id,
        publishedAt: new Date(),
      },
    });
    await prisma.bookAccess.create({ data: { bookId: book.id, userId: reader.id } });
    return plan;
  } finally {
    await prisma.$disconnect();
  }
}

export async function publishPwaVersion2(
  databaseUrl: string | undefined,
  container: import('@testcontainers/postgresql').StartedPostgreSqlContainer | null | undefined,
  storageDir: string,
  ownerId: string,
  bookId: string,
): Promise<void> {
  const { assertOwnedDisposableDatabaseUrl } = await import('./pwa-disposable-db.js');
  const assertOwned: (url: string | undefined, owner: typeof container) => asserts url is string = assertOwnedDisposableDatabaseUrl;
  assertOwned(databaseUrl, container);
  if (!/^[-a-f0-9]{36}$/i.test(ownerId) || !/^[-a-f0-9]{36}$/i.test(bookId)) throw new Error('Invalid fixture owner or book ID');
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('@prisma/client'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const book = await prisma.book.findUnique({ where: { id: bookId }, include: { pages: { orderBy: { index: 'asc' } } } });
    if (!book || book.title !== `PWA multi-page fixture ${ownerId}` || book.contentVersion !== 1) throw new Error('Book is not this owner\'s active v1 fixture');
    const storage = new LocalStorageAdapter(storageDir);
    const frameV2 = createPwaFramePayload(2);
    for (const page of book.pages) {
      const nextText = Buffer.from(`Version 2 publication content for page ${page.index}`);
      const assetKey = `books/${bookId}/v2/page-${page.index}.png`;
      const textKey = `books/${bookId}/v2/page-${page.index}.txt`;
      await storage.put(assetKey, frameV2, 'image/png');
      await storage.put(textKey, nextText, 'text/plain');
      await prisma.bookPage.update({ where: { id: page.id }, data: { assetKey, textKey, charCount: nextText.length } });
    }
    await prisma.book.update({ where: { id: bookId }, data: { contentVersion: 2, publishedAt: new Date() } });
  } finally {
    await prisma.$disconnect();
  }
}
