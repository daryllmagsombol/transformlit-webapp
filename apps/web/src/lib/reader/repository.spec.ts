import '../../../test/helpers/offline-dom-shims';
import {
  BookNotDownloadedError,
  BookNotReadyError,
  BookRepository,
  IncompleteBookError,
  RequestedVersionUnavailableError,
  type BookMetadata,
} from './repository';
import { OfflineDatabase, resetOfflineDatabaseHandle } from '../offline/database';
import {
  bookDownloadKey,
  bookPageKey,
  bookVersionKey,
  type BookPageRecord,
  type BookVersionRecord,
  type DownloadManifestRecord,
} from '../offline/contracts';
import { createMemoryIndexedDb, memoryIdbKeyRange, type MemoryIndexedDb } from '../../../test/helpers/memory-indexeddb';

const SUBJECT_A = 'subject-a';
const SUBJECT_B = 'subject-b';
const EPOCH = 1;
const BOOK_ID = 'book-1';

beforeAll(() => {
  if (typeof globalThis.IDBKeyRange === 'undefined') {
    Object.defineProperty(globalThis, 'IDBKeyRange', { writable: true, value: memoryIdbKeyRange });
  }
});

function pageRecord(subject: string, contentVersion: number, pageNumber: number): BookPageRecord {
  return {
    id: bookPageKey(subject, BOOK_ID, contentVersion, pageNumber),
    subject,
    bookId: BOOK_ID,
    contentVersion,
    pageNumber,
    imageAssetId: `p${pageNumber}:image`,
    textLayerAssetId: `p${pageNumber}:text`,
    image: new Blob([`frame-${contentVersion}-${pageNumber}`], { type: 'image/png' }),
    text: JSON.stringify({ items: [{ t: `Page ${pageNumber}`, x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] }),
    textItems: { items: [{ t: `Page ${pageNumber}`, x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] },
    verified: true,
  };
}

function versionRecord(
  subject: string,
  contentVersion: number,
  overrides: Partial<BookVersionRecord> = {},
): BookVersionRecord {
  return {
    id: bookVersionKey(subject, BOOK_ID, contentVersion),
    subject,
    bookId: BOOK_ID,
    contentVersion,
    status: 'READY',
    active: true,
    title: 'Stored Book',
    author: 'Stored Author',
    description: null,
    coverAssetId: null,
    totalPages: 2,
    toc: [{ id: 'toc-1', title: 'One', pageNumber: 1, order: 1 }],
    provenance: 'offline-manifest:contract-1',
    createdAt: 1,
    ...overrides,
  };
}

function manifestRecord(subject: string, contentVersion: number, activeVersion: number | null): DownloadManifestRecord {
  return {
    id: bookDownloadKey(subject, BOOK_ID),
    subject,
    kind: 'BOOK',
    contentId: BOOK_ID,
    contentVersion,
    activeVersion,
    status: 'READY',
    itemCount: 2,
    completedItems: 2,
    error: null,
    stagedAt: 1,
    updatedAt: 1,
  };
}

async function seedBook(
  database: OfflineDatabase,
  subject: string,
  contentVersion: number,
  options: { pages?: number[]; versionOverrides?: Partial<BookVersionRecord>; manifestActive?: number | null } = {},
): Promise<void> {
  await database.writeLifecycle({ id: 'lifecycle', state: 'ACTIVE', subject, epoch: EPOCH, updatedAt: 1 });
  await database.putDownloadRecord(subject, EPOCH, 'bookVersions', versionRecord(subject, contentVersion, options.versionOverrides));
  await database.putDownloadRecord(
    subject,
    EPOCH,
    'downloadManifests',
    manifestRecord(subject, contentVersion, options.manifestActive === undefined ? contentVersion : options.manifestActive),
  );
  const pages = options.pages ?? [1, 2];
  for (const pageNumber of pages) {
    await database.putDownloadRecord(subject, EPOCH, 'bookPages', pageRecord(subject, contentVersion, pageNumber));
  }
}

function networkMetadata(): BookMetadata {
  return {
    title: 'Network Book',
    author: 'Network Author',
    pageCount: 2,
    contentVersion: 7,
    conversionStatus: 'READY',
    toc: [{ id: 'toc-1', title: 'One', pageNumber: 1, order: 1 }],
  };
}

function createRepository(
  database: OfflineDatabase,
  overrides: Partial<ConstructorParameters<typeof BookRepository>[0]> = {},
) {
  const openSession = jest.fn().mockResolvedValue(undefined);
  const fetchText = jest.fn().mockResolvedValue({ items: [{ t: 'Network', x: 0, y: 0, w: 1, h: 1 }] });
  const frames: string[] = [];
  const revoked: string[] = [];
  const repository = new BookRepository({
    database,
    getOwner: () => ({ subject: SUBJECT_A, epoch: EPOCH }),
    fetchMetadata: jest.fn().mockResolvedValue(networkMetadata()),
    openSession,
    fetchText,
    frameUrl: (bookId, page) => `http://api.test/books/${bookId}/pages/${page}/frame`,
    createObjectUrl: (blob) => {
      const url = `blob:${frames.length}-${blob.size}`;
      frames.push(url);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
    ...overrides,
  });
  return { repository, openSession, fetchText, revoked };
}

describe('BookRepository', () => {
  let memory: MemoryIndexedDb;
  let database: OfflineDatabase;

  beforeEach(() => {
    memory = createMemoryIndexedDb();
    (globalThis as { indexedDB?: unknown }).indexedDB = memory.indexedDB;
    resetOfflineDatabaseHandle();
    database = new OfflineDatabase();
  });

  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  describe('local opening', () => {
    it('opens a ready active version with local capabilities and pinned metadata', async () => {
      await seedBook(database, SUBJECT_A, 3);
      const { repository, openSession } = createRepository(database);

      const opened = await repository.open(BOOK_ID, undefined, { localOnly: true });

      expect(opened.source).toBe('local');
      expect(opened.contentVersion).toBe(3);
      expect(opened.title).toBe('Stored Book');
      expect(opened.pageCount).toBe(2);
      expect(opened.capabilities).toEqual({
        audio: false,
        remoteSearch: false,
        enrichment: false,
        realtime: false,
        navigation: true,
      });
      // Local opening must never start a reading session.
      expect(openSession).not.toHaveBeenCalled();
    });

    it('returns blob-backed frames and text from the stored page', async () => {
      await seedBook(database, SUBJECT_A, 1);
      const { repository } = createRepository(database);
      const opened = await repository.open(BOOK_ID, undefined, { localOnly: true });

      const page = await opened.openPage(2);

      expect(page.pageNumber).toBe(2);
      expect(page.frame.source).toBe('local');
      expect(page.frame.url.startsWith('blob:')).toBe(true);
      expect(page.items?.[0].t).toBe('Page 2');
    });

    it('stores page images as Blobs that expose arrayBuffer() for retry re-hashing', async () => {
      await seedBook(database, SUBJECT_A, 1);
      const stored = await database.getBookPages(SUBJECT_A, BOOK_ID, 1);
      const image = stored.find((page) => page.pageNumber === 1)?.image;
      expect(image).not.toBeNull();
      expect(typeof image?.arrayBuffer).toBe('function');
      const bytes = new Uint8Array(await (image as Blob).arrayBuffer());
      expect(new TextDecoder().decode(bytes)).toBe('frame-1-1');
    });

    it('rejects a requested version that is not the ready active version', async () => {
      await seedBook(database, SUBJECT_A, 3);
      const { repository } = createRepository(database);

      await expect(repository.open(BOOK_ID, 2, { localOnly: true })).rejects.toBeInstanceOf(
        RequestedVersionUnavailableError,
      );
    });

    it('rejects a dataset that is not ready', async () => {
      await seedBook(database, SUBJECT_A, 1, { versionOverrides: { status: 'STAGED', active: false } });
      const { repository } = createRepository(database);

      await expect(repository.open(BOOK_ID, undefined, { localOnly: true })).rejects.toBeInstanceOf(BookNotReadyError);
    });

    it('rejects an incomplete dataset missing required pages', async () => {
      await seedBook(database, SUBJECT_A, 1, { pages: [1] });
      const { repository } = createRepository(database);

      await expect(repository.open(BOOK_ID, undefined, { localOnly: true })).rejects.toBeInstanceOf(
        IncompleteBookError,
      );
    });

    it('rejects a dataset owned by another subject instead of returning it', async () => {
      await seedBook(database, SUBJECT_B, 1);
      // Re-open the DB handle under owner A's view.
      const { repository } = createRepository(database);

      await expect(repository.open(BOOK_ID, undefined, { localOnly: true })).rejects.toBeInstanceOf(
        BookNotDownloadedError,
      );
    });
  });

  describe('frame disposal', () => {
    it('revokes a blob frame exactly once', async () => {
      await seedBook(database, SUBJECT_A, 1);
      const { repository, revoked } = createRepository(database);
      const opened = await repository.open(BOOK_ID, undefined, { localOnly: true });
      const page = await opened.openPage(1);

      page.frame.dispose();
      page.frame.dispose();

      expect(revoked).toEqual([page.frame.url]);
    });
  });

  describe('network opening', () => {
    it('opens a reading session and returns network frames with full capabilities', async () => {
      const { repository, openSession, fetchText } = createRepository(database);

      const opened = await repository.open(BOOK_ID);

      expect(opened.source).toBe('network');
      expect(opened.title).toBe('Network Book');
      expect(opened.capabilities).toEqual({
        audio: true,
        remoteSearch: true,
        enrichment: true,
        realtime: true,
        navigation: true,
      });
      expect(openSession).toHaveBeenCalledTimes(1);

      const page = await opened.openPage(1);
      expect(page.frame.source).toBe('network');
      expect(page.frame.url).toBe('http://api.test/books/book-1/pages/1/frame');
      expect(fetchText).toHaveBeenCalledWith(BOOK_ID, 1);
    });
  });
});
