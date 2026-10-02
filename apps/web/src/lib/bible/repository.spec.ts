import { BibleChapterNotDownloadedError, BibleRepository } from './repository';
import { OfflineDatabase, resetOfflineDatabaseHandle } from '../offline/database';
import { bibleChapterKey, type BibleChapterRecord } from '../offline/contracts';
import { createMemoryIndexedDb, memoryIdbKeyRange, type MemoryIndexedDb } from '../../../test/helpers/memory-indexeddb';
import type { BibleChapter } from './types';

const SUBJECT_A = 'subject-a';
const SUBJECT_B = 'subject-b';
const EPOCH = 1;
const TRANSLATION = 'PERMITTED';
const BOOK = 'ROM';
const CHAPTER = 8;

beforeAll(() => {
  if (typeof globalThis.IDBKeyRange === 'undefined') {
    Object.defineProperty(globalThis, 'IDBKeyRange', { writable: true, value: memoryIdbKeyRange });
  }
});

function chapterPayload(): BibleChapter {
  return {
    translation: { id: TRANSLATION, name: 'Permitted Version', shortName: 'PV' },
    book: {
      id: BOOK,
      name: 'Romans',
      commonName: 'Romans',
      title: null,
      order: 45,
      numberOfChapters: 16,
      firstChapterNumber: 1,
      lastChapterNumber: 16,
      totalNumberOfVerses: 433,
    },
    thisChapterLink: `/api/${TRANSLATION}/${BOOK}/${CHAPTER}.json`,
    nextChapterApiLink: null,
    previousChapterApiLink: null,
    thisChapterAudioLinks: { gilbert: `https://audio.example/${BOOK}/${CHAPTER}.mp3` },
    numberOfVerses: 1,
    chapter: {
      number: CHAPTER,
      content: [{ type: 'verse', number: 1, content: ['There is therefore now'] }],
      footnotes: [],
    },
  };
}

function chapterRecord(subject: string): BibleChapterRecord {
  return {
    id: bibleChapterKey(subject, TRANSLATION, BOOK, CHAPTER),
    subject,
    translation: TRANSLATION,
    book: BOOK,
    chapter: CHAPTER,
    contentVersion: 1,
    text: 'There is therefore now',
    payload: chapterPayload(),
    translationMeta: { id: TRANSLATION, name: 'Permitted Version', shortName: 'PV' },
    bookMeta: { id: BOOK, commonName: 'Romans', firstChapterNumber: 1, lastChapterNumber: 16 },
    chapterBounds: { firstChapter: 1, lastChapter: 16 },
    provenance: 'test',
    attribution: 'Example Attribution',
    downloadedAt: 1,
  };
}

function createRepository(database: OfflineDatabase) {
  return new BibleRepository({
    database,
    getOwner: () => ({ subject: SUBJECT_A, epoch: EPOCH }),
  });
}

async function seedChapter(database: OfflineDatabase, subject: string): Promise<void> {
  await database.writeLifecycle({ id: 'lifecycle', state: 'ACTIVE', subject, epoch: EPOCH, updatedAt: 1 });
  await database.putBibleChapter(subject, EPOCH, chapterRecord(subject));
}

describe('BibleRepository', () => {
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

  it('opens a saved chapter from stored records', async () => {
    await seedChapter(database, SUBJECT_A);
    const opened = await createRepository(database).openChapter(TRANSLATION, BOOK, CHAPTER);

    expect(opened.source).toBe('local');
    expect(opened.translationMeta.shortName).toBe('PV');
    expect(opened.bookMeta.commonName).toBe('Romans');
    expect(opened.chapterContent.number).toBe(CHAPTER);
    expect(opened.contentVersion).toBe(1);
  });

  it('reports local capabilities without network-only features', async () => {
    await seedChapter(database, SUBJECT_A);
    const opened = await createRepository(database).openChapter(TRANSLATION, BOOK, CHAPTER);

    expect(opened.capabilities).toEqual({
      audio: false,
      remoteSearch: false,
      enrichment: false,
      realtime: false,
      navigation: true,
    });
  });

  it('reports both chapter bounds for local navigation', async () => {
    await seedChapter(database, SUBJECT_A);
    const opened = await createRepository(database).openChapter(TRANSLATION, BOOK, CHAPTER);

    expect(opened.navigation).toEqual({ firstChapter: 1, lastChapter: 16 });
    expect(opened.attribution).toBe('Example Attribution');
  });

  it('rejects a chapter that is not saved for this owner', async () => {
    await seedChapter(database, SUBJECT_B);
    await expect(createRepository(database).openChapter(TRANSLATION, BOOK, CHAPTER)).rejects.toBeInstanceOf(
      BibleChapterNotDownloadedError,
    );
  });
});
