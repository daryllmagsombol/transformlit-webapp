import {
  createConflictCopyPersister,
  createSnapshotStore,
  createReceiptStore,
  createOutboxStore,
  toOutcome,
} from './sync-service';
import { OfflineDatabase, resetOfflineDatabaseHandle } from './database';
import {
  qualifyKey,
  type AccountOwner,
  type ConflictCopyRecord,
  type HighlightRecord,
  type OutboxReceiptRecord,
} from './contracts';
import type { BookMergeResult } from './sync-coordinator';
import type { OutboxOperationRecord } from './outbox';
import { ConflictResolver, type StoredConflictCopyRecord } from './conflicts';
import type { MergeAnnotation } from './snapshot-merge';
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

/** A server-authoritative merged annotation with a sane payload. */
function serverAnnotation(overrides: Partial<MergeAnnotation> & { id: string }): MergeAnnotation {
  return {
    kind: 'ANNOTATION',
    clientEntityId: null,
    revision: 1,
    deletedAt: null,
    data: {
      contentVersion: 1,
      page: 1,
      text: 'server text',
      note: null,
      color: null,
      anchor: null,
      createdAt: 1,
      updatedAt: 1,
    },
    ...overrides,
  };
}

/** A durable outbox operation with a subject-namespaced id. */
function outboxOp(
  overrides: Partial<OutboxOperationRecord> & { id: string; seq: number },
): OutboxOperationRecord {
  return {
    subject: OWNER.subject,
    epoch: OWNER.epoch,
    operationId: `op-${overrides.id}`,
    entityKey: qualifyKey(OWNER.subject, 'highlight', 'client-1'),
    bookId: BOOK,
    contentVersion: 1,
    kind: 'ANNOTATION_UPDATE',
    dependsOn: null,
    baseRevision: 2,
    dispatchState: 'PENDING',
    attemptCount: 0,
    payload: { entityId: 'server-1', page: 1, text: 'offline edit', note: null, color: null, anchor: null },
    createdAt: overrides.seq,
    ...overrides,
    id: qualifyKey(OWNER.subject, 'outbox', overrides.id),
  };
}

/** A stored conflict copy (unresolved by default). */
function storedCopy(overrides: Partial<StoredConflictCopyRecord> = {}): StoredConflictCopyRecord {
  return {
    id: qualifyKey(OWNER.subject, 'conflict', 'cc-1'),
    serverId: 'cc-1',
    subject: OWNER.subject,
    operationId: 'op-a',
    sourceEntityId: 'server-1',
    bookId: BOOK,
    contentVersion: 1,
    page: 1,
    text: 'offline edit',
    note: null,
    color: null,
    anchor: null,
    revision: 3,
    reason: 'STALE_REVISION',
    createdAt: 1,
    ...overrides,
  };
}

/** A wire/server conflict copy (plain `id`, as the snapshot source produces). */
function serverCopy(revision: number): ConflictCopyRecord {
  return {
    id: 'cc-1',
    subject: OWNER.subject,
    operationId: 'op-a',
    sourceEntityId: 'server-1',
    bookId: BOOK,
    contentVersion: 1,
    page: 1,
    text: 'offline edit',
    note: null,
    color: null,
    anchor: null,
    revision,
    reason: 'STALE_REVISION',
    createdAt: 1,
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

  // ── C2: merged annotations are projected into local readerRecords ─────────
  it('projects a server annotation absent locally into readerRecords so it becomes visible', async () => {
    const database = new OfflineDatabase();
    const store = createSnapshotStore(database);

    await store.applyMerge(OWNER, mergeResult({
      annotations: [
        serverAnnotation({
          id: 'server-hl-1',
          clientEntityId: 'client-hl-1',
          revision: 4,
          data: { contentVersion: 1, page: 3, text: 'cross-device highlight', note: null, color: null, anchor: null, createdAt: 1, updatedAt: 1 },
        }),
      ],
    }));

    const rows = await database.getAllByIndex<HighlightRecord>('readerRecords', 'subjectBook', [OWNER.subject, BOOK]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bookId: BOOK,
      page: 3,
      text: 'cross-device highlight',
      revision: 4,
      deletedAt: null,
      serverEntityId: 'server-hl-1',
    });
  });

  it('removes a stale local row when the server tombstone matches its server entity id', async () => {
    const database = new OfflineDatabase();
    const store = createSnapshotStore(database);
    const entityKey = qualifyKey(OWNER.subject, 'highlight', 'client-1');
    await database.putAccountRecord(OWNER.subject, OWNER.epoch, 'readerRecords', {
      id: entityKey,
      subject: OWNER.subject,
      clientEntityId: 'client-1',
      serverEntityId: 'server-1',
      bookId: BOOK,
      contentVersion: 1,
      page: 1,
      text: 'stale local',
      note: null,
      color: null,
      anchor: null,
      revision: 2,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      syncedAt: 5,
    });

    await store.applyMerge(OWNER, mergeResult({
      tombstones: [{ entityId: 'server-1', kind: 'ANNOTATION', revision: 3, deletedAt: 10 }],
    }));

    const row = await database.get<HighlightRecord>('readerRecords', entityKey);
    expect(row?.deletedAt).not.toBeNull();
  });

  // ── C3: a snapshot refresh preserves a resolved conflict copy ─────────────
  it('preserves local conflict-copy resolution across a snapshot refresh (no duplicate replay)', async () => {
    const database = new OfflineDatabase();
    const store = createSnapshotStore(database);
    const base = outboxOp({ id: 'a', seq: 1, dispatchState: 'FAILED' });
    const successor = outboxOp({ id: 'b', seq: 2, dependsOn: base.id, baseRevision: 2 });
    await database.commitOutbox(OWNER.subject, OWNER.epoch, base);
    await database.commitOutbox(OWNER.subject, OWNER.epoch, successor);
    await database.putAccountRecord(OWNER.subject, OWNER.epoch, 'conflicts', storedCopy());

    let counter = 0;
    const resolver = new ConflictResolver({
      database,
      getOwner: () => OWNER,
      now: () => 1000,
      newId: () => `new-${(counter += 1)}`,
    });
    const conflict = (await resolver.listConflicts(BOOK))[0];

    const first = await resolver.keepOfflineCopy(conflict);
    expect(first.status).toBe('RESOLVED');
    expect(first.enqueuedOperationIds).toEqual(['new-1']);

    // A later snapshot refresh re-delivers the SAME server copy (plain server
    // id) with a bumped revision. The local resolution marker must survive so
    // the resolver's idempotence guard suppresses a second retargeted op.
    await store.applyMerge(OWNER, mergeResult({
      conflictCopies: [serverCopy(9)],
    }));

    const copies = await database.getAllByIndex<StoredConflictCopyRecord>('conflicts', 'subject', OWNER.subject);
    expect(copies).toHaveLength(1);
    expect(copies[0].resolution).toBe('OFFLINE_COPY');
    expect(copies[0].resolvedAt).toBe(1000);

    const afterRefresh = await resolver.keepOfflineCopy(conflict);
    expect(afterRefresh.status).toBe('RESOLVED');
    expect(afterRefresh.enqueuedOperationIds).toEqual([]);

    const rows = await database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', OWNER.subject);
    expect(rows.map((row) => row.operationId)).toEqual(['new-1']);
  });

  // ── I6: a CONFLICT outcome persists its conflict copy immediately ─────────
  it('persists a conflict copy from a CONFLICT outcome so it is resolvable before any snapshot', async () => {
    const database = new OfflineDatabase();
    const operation = outboxOp({ id: 'a', seq: 1, dispatchState: 'FAILED' });
    const successor = outboxOp({ id: 'b', seq: 2, dependsOn: operation.id, baseRevision: 2 });
    await database.commitOutbox(OWNER.subject, OWNER.epoch, operation);
    await database.commitOutbox(OWNER.subject, OWNER.epoch, successor);

    // Mirrors production wiring: the coordinator persists the returned copy on
    // CONFLICT via `createConflictCopyPersister`; here we assert the durable copy
    // is resolvable without any snapshot refresh.
    const persist = createConflictCopyPersister(database);
    await persist(OWNER, operation, {
      kind: 'CONFLICT',
      entityId: 'server-1',
      serverRevision: 5,
      serverValue: { id: 'server-1', revision: 5 },
      conflictCopyId: 'cc-1',
      conflictCopy: {
        id: 'cc-1',
        operationId: operation.operationId,
        sourceEntityId: 'server-1',
        bookId: BOOK,
        contentVersion: 1,
        page: 1,
        text: 'offline edit',
        note: null,
        color: null,
        anchor: null,
        revision: 3,
        reason: 'STALE_REVISION',
        createdAt: 1,
      },
    });

    const resolver = new ConflictResolver({ database, getOwner: () => OWNER, now: () => 1000, newId: () => 'new-1' });
    const conflicts = await resolver.listConflicts(BOOK);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictCopy?.serverId).toBe('cc-1');

    const result = await resolver.keepOfflineCopy(conflicts[0]);
    expect(result.status).toBe('RESOLVED');
    expect(result.enqueuedOperationIds).toEqual(['new-1']);
  });
});
