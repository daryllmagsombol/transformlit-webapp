import { randomUUID } from 'node:crypto';

export interface PwaFixturePlan {
  ownerId: string;
  accounts: readonly { id: string; email: string; displayName: string }[];
  books: {
    readable: { id: string; title: string; pages: readonly { index: number; text: string }[]; contentVersions: readonly number[] };
    restricted: { id: string; title: string; restricted: true };
    publicationChangeDuringDownload: true;
  };
}

export function createPwaFixturePlan(ownerId: string): PwaFixturePlan {
  return {
    ownerId,
    accounts: [
      { id: randomUUID(), email: 'pwa-reader@example.test', displayName: 'PWA Reader' },
      { id: randomUUID(), email: 'pwa-outsider@example.test', displayName: 'PWA Outsider' },
    ],
    books: {
      readable: {
        id: randomUUID(),
        title: 'PWA multi-page fixture',
        pages: [1, 2, 3].map((index) => ({ index, text: `Fixture page ${index}` })),
        contentVersions: [1, 2],
      },
      restricted: { id: randomUUID(), title: 'PWA restricted fixture', restricted: true },
      publicationChangeDuringDownload: true,
    },
  };
}

/** Database writes are only allowed when the caller supplies Task 1A's live container. */
export async function seedPwaFixtures(
  databaseUrl: string | undefined,
  container: import('@testcontainers/postgresql').StartedPostgreSqlContainer | null | undefined,
): Promise<PwaFixturePlan> {
  const { assertOwnedDisposableDatabaseUrl } = await import('./pwa-disposable-db.js');
  const assertOwned: (url: string | undefined, owner: typeof container) => asserts url is string = assertOwnedDisposableDatabaseUrl;
  assertOwned(databaseUrl, container);
  const plan = createPwaFixturePlan('pwa-harness');
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([import('@prisma/client'), import('@prisma/adapter-pg')]);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const users = await Promise.all(plan.accounts.map((account) => prisma.user.create({
      data: {
        id: account.id,
        email: account.email,
        emailNormalized: account.email,
        displayName: account.displayName,
        passwordHash: null,
      },
    })));
    const [reader, outsider] = users;
    const book = await prisma.book.create({
      data: {
        id: plan.books.readable.id,
        title: plan.books.readable.title,
        status: 'PUBLISHED',
        accessLevel: 'FREE',
        totalPages: plan.books.readable.pages.length,
        pageCount: plan.books.readable.pages.length,
        contentVersion: 1,
        createdById: reader.id,
        publishedAt: new Date(),
        pages: { create: plan.books.readable.pages.map((page) => ({ index: page.index, assetKey: `pwa/${page.index}`, textKey: `pwa/${page.index}.txt`, mimeType: 'text/plain', charCount: page.text.length })) },
      },
    });
    await prisma.book.create({
      data: {
        id: plan.books.restricted.id,
        title: plan.books.restricted.title,
        status: 'PUBLISHED',
        accessLevel: 'RESTRICTED',
        totalPages: 1,
        createdById: outsider.id,
        publishedAt: new Date(),
      },
    });
    await prisma.bookAccess.create({ data: { bookId: book.id, userId: reader.id } });
    await prisma.book.update({ where: { id: book.id }, data: { contentVersion: 2 } });
    return plan;
  } finally {
    await prisma.$disconnect();
  }
}
