import { ReaderRecords } from './reader-records';
import { OfflineDatabase, resetOfflineDatabaseHandle } from './database';
import { createMemoryIndexedDb, memoryIdbKeyRange, type MemoryIndexedDb } from '../../../test/helpers/memory-indexeddb';
import { keyBelongsToSubject, type AccountOwner, type OutboxOperation } from './contracts';
import type { OutboxOperationRecord } from './outbox';

const OWNER: AccountOwner = { subject: 'subject-a', epoch: 1 };
const BOOK = 'book-1';

let idCounter = 0;

function createHarness(owner: AccountOwner | null = OWNER) {
  const memory: MemoryIndexedDb = createMemoryIndexedDb();
  (globalThis as { indexedDB?: unknown }).indexedDB = memory.indexedDB;
  resetOfflineDatabaseHandle();
  const database = new OfflineDatabase();
  const records = new ReaderRecords({
    database,
    getOwner: () => owner,
    now: () => 1_700_000_000_000,
    newId: () => `id-${(idCounter += 1)}`,
  });
  return { memory, database, records };
}

async function seedLifecycle(database: OfflineDatabase, owner: AccountOwner | null): Promise<void> {
  await database.writeLifecycle({
    id: 'lifecycle',
    state: owner ? 'ACTIVE' : 'SIGNED_OUT',
    subject: owner?.subject ?? null,
    epoch: owner?.epoch ?? 0,
    updatedAt: 1,
  });
}

async function listOutbox(database: OfflineDatabase, subject: string): Promise<OutboxOperationRecord[]> {
  return database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', subject);
}

describe('ReaderRecords local-first mutations', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('reports SAVED and persists the progress record plus its outbox operation atomically', async () => {
    const { database, records } = createHarness();
    await seedLifecycle(database, OWNER);

    const result = await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 5, scrollY: 40 });

    expect(result.status).toBe('SAVED');
    const progress = await records.getProgress(BOOK);
    expect(progress?.currentPage).toBe(5);
    const outbox = await listOutbox(database, OWNER.subject);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      subject: OWNER.subject,
      epoch: OWNER.epoch,
      kind: 'PROGRESS_SET',
      baseRevision: 0,
      contentVersion: 1,
      dispatchState: 'PENDING',
      seq: 1,
    });
  });

  it('reports FAILED and leaves no partial record when the transaction aborts', async () => {
    const { database, records, memory } = createHarness();
    await seedLifecycle(database, OWNER);
    // The outbox write fails; the atomic transaction must roll back the record too.
    memory.failPutWhen((store) => store === 'outbox');

    const result = await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 7, scrollY: null });

    expect(result.status).toBe('FAILED');
    expect(result.error).toBeTruthy();
    expect(await records.getProgress(BOOK)).toBeNull();
    expect(await listOutbox(database, OWNER.subject)).toHaveLength(0);
  });

  it('refuses to save when no account is established', async () => {
    const { database, records } = createHarness(null);
    await seedLifecycle(database, null);
    const result = await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 1, scrollY: null });
    expect(result).toMatchObject({ status: 'FAILED', operationId: null });
  });

  it('coalesces a newer unsent progress pair onto the original unsent operation', async () => {
    const { database, records } = createHarness();
    await seedLifecycle(database, OWNER);

    await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 2, scrollY: null });
    const firstOutbox = await listOutbox(database, OWNER.subject);
    expect(firstOutbox).toHaveLength(1);

    await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 9, scrollY: 12 });

    const outbox = await listOutbox(database, OWNER.subject);
    expect(outbox).toHaveLength(1);
    // Original operation id retained; payload advanced.
    expect(outbox[0].operationId).toBe(firstOutbox[0].operationId);
    expect(outbox[0].payload).toEqual({ currentPage: 9, scrollY: 12 });
    // Durability happened immediately; only the payload coalesced.
    expect((await records.getProgress(BOOK))?.currentPage).toBe(9);
  });

  it('does not coalesce into a dispatched progress operation; a later edit appends separately', async () => {
    const { database, records } = createHarness();
    await seedLifecycle(database, OWNER);
    await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 2, scrollY: null });

    // Simulate Task 11 having dispatched the first operation.
    const [first] = await listOutbox(database, OWNER.subject);
    await database.putAccountRecord(OWNER.subject, OWNER.epoch, 'outbox', {
      ...first,
      dispatchState: 'DISPATCHED',
    });

    await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 3, scrollY: null });

    const outbox = await listOutbox(database, OWNER.subject);
    expect(outbox).toHaveLength(2);
    const dispatched = outbox.find((row) => row.operationId === first.operationId);
    expect(dispatched?.payload).toEqual({ currentPage: 2, scrollY: null });
    const appended = outbox.find((row) => row.operationId !== first.operationId);
    expect(appended?.seq).toBeGreaterThan(first.seq);
  });

  it('keeps a create and a later update as separate ordered operations for one entity', async () => {
    const { database, records } = createHarness();
    await seedLifecycle(database, OWNER);

    const created = await records.createHighlight({
      bookId: BOOK,
      contentVersion: 1,
      page: 1,
      text: 'hello',
      note: null,
      color: null,
      anchor: { version: 1, page: 1, startOffset: 0, endOffset: 5 },
    });
    expect(created.status).toBe('SAVED');

    const highlights = await records.listHighlights(BOOK);
    expect(highlights).toHaveLength(1);
    const highlight = highlights[0];

    const updated = await records.updateHighlight({
      bookId: BOOK,
      contentVersion: 1,
      entityId: highlight.id,
      baseRevision: highlight.revision,
      page: 1,
      text: 'hello',
      note: 'a note',
      color: null,
      anchor: { version: 1, page: 1, startOffset: 0, endOffset: 5 },
    });
    expect(updated.status).toBe('SAVED');

    const outbox = await listOutbox(database, OWNER.subject);
    expect(outbox).toHaveLength(2);
    expect(outbox[0].kind).toBe('ANNOTATION_CREATE');
    expect(outbox[1].kind).toBe('ANNOTATION_UPDATE');
    // The edit depends on the create and never shares its payload/id.
    expect(outbox[1].dependsOn).toBe(outbox[0].id);
    expect(outbox[1].payload).not.toEqual(outbox[0].payload);

    // The in-flight create's payload is still the untouched original.
    expect(outbox[0].payload).toMatchObject({ text: 'hello', note: null });
    expect(outbox[1].payload).toMatchObject({ text: 'hello', note: 'a note' });
  });

  it('adds and removes a bookmark only (no label/color editing), keeping local state in step', async () => {
    const { database, records } = createHarness();
    await seedLifecycle(database, OWNER);

    const added = await records.addBookmark({ bookId: BOOK, contentVersion: 1, page: 4, anchor: null });
    expect(added.status).toBe('SAVED');
    const bookmarks = await records.listBookmarks(BOOK);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({ label: null, color: null, page: 4 });

    const removed = await records.removeBookmark({
      bookId: BOOK,
      contentVersion: 1,
      entityId: bookmarks[0].id,
      baseRevision: bookmarks[0].revision,
    });
    expect(removed.status).toBe('SAVED');
    expect(await records.listBookmarks(BOOK)).toHaveLength(0);

    const outbox = await listOutbox(database, OWNER.subject);
    expect(outbox.map((row) => row.kind)).toEqual(['BOOKMARK_ADD', 'BOOKMARK_REMOVE']);
  });

  it('survives a cold restart: records and outbox reload from the same store', async () => {
    const memory = createMemoryIndexedDb();
    (globalThis as { indexedDB?: unknown }).indexedDB = memory.indexedDB;
    resetOfflineDatabaseHandle();
    const database = new OfflineDatabase();
    await seedLifecycle(database, OWNER);
    const records = new ReaderRecords({
      database,
      getOwner: () => OWNER,
      now: () => 1_700_000_000_000,
      newId: () => `id-${(idCounter += 1)}`,
    });
    await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 11, scrollY: null });
    await records.addBookmark({ bookId: BOOK, contentVersion: 1, page: 2, anchor: null });

    // "Restart": drop module handles and re-open from the same in-memory store.
    resetOfflineDatabaseHandle();
    const reopened = new ReaderRecords({ database: new OfflineDatabase(), getOwner: () => OWNER });
    expect((await reopened.getProgress(BOOK))?.currentPage).toBe(11);
    expect(await reopened.listBookmarks(BOOK)).toHaveLength(1);
    expect((await listOutbox(new OfflineDatabase(), OWNER.subject)).length).toBeGreaterThanOrEqual(2);
  });

  it('namespaces every record and outbox key by the owner subject', async () => {
    const { database, records } = createHarness();
    await seedLifecycle(database, OWNER);
    await records.saveProgress({ bookId: BOOK, contentVersion: 1, currentPage: 1, scrollY: null });
    const outbox = await listOutbox(database, OWNER.subject);
    for (const operation of outbox) {
      expect(operation.subject).toBe(OWNER.subject);
      expect(keyBelongsToSubject(OWNER.subject, operation.id)).toBe(true);
    }
  });
});

describe('ReaderRecords never routes Bible content', () => {
  it('exposes no Bible mutation entrypoint', () => {
    const { records } = createHarness();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(records));
    expect(methods.some((name) => name.toLowerCase().includes('bible'))).toBe(false);
  });
});

/** The outbox operation contract must include every field the brief requires. */
it('outbox operations carry owner, epoch, operationId, entityKey, seq, dependency, base revision, version, payload and dispatch state', async () => {
  const { database, records } = createHarness();
  await seedLifecycle(database, OWNER);
  await records.addBookmark({ bookId: BOOK, contentVersion: 3, page: 1, anchor: null });
  const [operation] = await listOutbox(database, OWNER.subject);
  expect(operation).toMatchObject({
    subject: OWNER.subject,
    epoch: OWNER.epoch,
    operationId: expect.any(String),
    entityKey: expect.any(String),
    seq: expect.any(Number),
    dependsOn: null,
    baseRevision: null,
    contentVersion: 3,
    dispatchState: 'PENDING',
    payload: expect.any(Object),
  });
  expect(operation as unknown as OutboxOperation).toBeTruthy();
});
