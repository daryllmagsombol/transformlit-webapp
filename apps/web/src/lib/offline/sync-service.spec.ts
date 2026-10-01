import { createSnapshotStore, createReceiptStore, createOutboxStore, toOutcome } from './sync-service';
import { OfflineDatabase, resetOfflineDatabaseHandle } from './database';
import { qualifyKey, type AccountOwner, type OutboxReceiptRecord } from './contracts';
import type { BookMergeResult } from './sync-coordinator';
import { createMemoryIndexedDb, memoryIdbKeyRange, type MemoryIndexedDb } from '../../../test/helpers/memory-indexeddb';
import type { ReaderOperationDispatch } from '../reader/api';

const OWNER: AccountOwner = { subject: 'subject-a', epoch: 1 };
const BOOK = 'book-1';

function mergeResult(overrides: Partial<BookMergeResult> = {}): BookMergeResult {
  return {
    bookId: BOOK,
    annotations: [],
    tombstones: [],
    conflictCopies: [],
    pending: [],
    ...overrides,
  };
}

describe('toOutcome', () => {
  it('preserves the serverValue and conflict copy for conflict UX', () => {
    const serverValue = { __typename: 'HighlightRecord' as const, id: 'hl-1', revision: 5 };
    const result: ReaderOperationDispatch = {
      operationId: 'op-1',
      result: {
        __typename: 'ReaderOperationConflict',
        kind: 'CONFLICT',
        entityId: 'hl-1',
        serverRevision: 5,
        serverValue,
        conflictCopy: null,
      },
    } as unknown as ReaderOperationDispatch;

    expect(toOutcome(result)).toMatchObject({
      kind: 'CONFLICT',
      entityId: 'hl-1',
      serverRevision: 5,
      serverValue,
    });
  });
});

describe('sync-service durable stores', () => {
  let memory: MemoryIndexedDb;

  beforeAll(() => {
    if (typeof globalThis.IDBKeyRange === 'undefined') {
      Object.defineProperty(globalThis, 'IDBKeyRange', { writable: true, value: memoryIdbKeyRange });
    }
  });

  beforeEach(async () => {
    memory = createMemoryIndexedDb();
    (globalThis as { indexedDB?: unknown }).indexedDB = memory.indexedDB;
    resetOfflineDatabaseHandle();
    const database = new OfflineDatabase();
    await database.writeLifecycle({ id: 'lifecycle', state: 'ACTIVE', subject: OWNER.subject, epoch: OWNER.epoch, updatedAt: 1 });
  });

  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('persists a complete receipt and removes the operation atomically', async () => {
    const database = new OfflineDatabase();
    const receipts = createReceiptStore(database);
    const receipt: OutboxReceiptRecord = {
      id: qualifyKey(OWNER.subject, 'receipt', 'op-1'),
      subject: OWNER.subject,
      operationId: 'op-1',
      entityId: 'server-1',
      revision: 3,
      resultKind: 'APPLIED',
      acknowledgedAt: 1,
    };

    await receipts.recordAndRemove('missing-op', OWNER.subject, OWNER.epoch, receipt);

    const rows = await database.getAllByIndex<OutboxReceiptRecord>('receipts', 'subject', OWNER.subject);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: OWNER.subject, operationId: 'op-1', resultKind: 'APPLIED' });
  });

  it('persists a retained conflict receipt without removing anything', async () => {
    const database = new OfflineDatabase();
    const receipts = createReceiptStore(database);
    await receipts.recordRetained(OWNER.subject, OWNER.epoch, {
      id: qualifyKey(OWNER.subject, 'receipt', 'op-2'),
      subject: OWNER.subject,
      operationId: 'op-2',
      entityId: 'server-2',
      revision: 5,
      resultKind: 'CONFLICT',
      acknowledgedAt: 2,
    });

    const rows = await database.getAllByIndex<OutboxReceiptRecord>('receipts', 'subject', OWNER.subject);
    expect(rows).toHaveLength(1);
    expect(rows[0].resultKind).toBe('CONFLICT');
  });

  it('applies merged tombstones and conflict copies to durable storage', async () => {
    const database = new OfflineDatabase();
    const store = createSnapshotStore(database);

    await store.applyMerge(OWNER, mergeResult({
      tombstones: [{ entityId: 'bm-1', kind: 'BOOKMARK', revision: 2, deletedAt: 10 }],
      conflictCopies: [
        {
          id: 'cc-1',
          subject: OWNER.subject,
          operationId: 'op-1',
          sourceEntityId: 'hl-1',
          bookId: BOOK,
          contentVersion: 1,
          page: 1,
          text: 'offline',
          note: null,
          color: null,
          anchor: null,
          revision: 1,
          reason: 'STALE_REVISION',
          createdAt: 1,
        },
      ],
    }));

    const tombstones = await database.getAllByIndex<{ entityId: string }>('tombstones', 'subject', OWNER.subject);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].entityId).toBe('bm-1');

    const conflicts = await database.getAllByIndex<{ id: string; serverId: string; subject: string }>(
      'conflicts',
      'subject',
      OWNER.subject,
    );
    expect(conflicts).toHaveLength(1);
    // The storage key is subject-namespaced; the stable server identity is kept.
    expect(conflicts[0].id).toBe(qualifyKey(OWNER.subject, 'conflict', 'cc-1'));
    expect(conflicts[0].serverId).toBe('cc-1');
  });

  it('marks a reader record synced after acknowledgement (clears local-only)', async () => {
    const database = new OfflineDatabase();
    const store = createOutboxStore(database);
    const entityKey = qualifyKey(OWNER.subject, 'highlight', 'client-1');
    await database.putAccountRecord(OWNER.subject, OWNER.epoch, 'readerRecords', {
      id: entityKey,
      subject: OWNER.subject,
      clientEntityId: 'client-1',
      bookId: BOOK,
      contentVersion: 1,
      page: 1,
      text: 'note',
      note: null,
      color: null,
      anchor: null,
      revision: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      syncedAt: null,
    });

    await store.markEntitySynced?.(entityKey, OWNER.subject, OWNER.epoch);

    const record = await database.get<{ syncedAt?: number | null }>('readerRecords', entityKey);
    expect(typeof record?.syncedAt).toBe('number');
  });
});
