import {
  createConflictCopyPersister,
  createSnapshotStore,
  createReceiptStore,
  createOutboxStore,
  createContentVersionResolver,
  createLocalAnnotationReader,
  createLocalOnlyCounter,
  toOutcome,
} from './sync-service';
import { SyncCoordinator, type OperationOutcome } from './sync-coordinator';
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

  it('maps every applied/version/access variant to its outcome', () => {
    expect(
      toOutcome({
        operationId: 'op-1',
        result: {
          __typename: 'ReaderOperationApplied',
          entityId: 'hl-1',
          revision: 7,
          receiptId: 'r1',
        },
      } as unknown as ReaderOperationDispatch),
    ).toEqual({ kind: 'APPLIED', entityId: 'hl-1', revision: 7, receiptId: 'r1' });

    expect(
      toOutcome({
        operationId: 'op-2',
        result: {
          __typename: 'ReaderOperationIncompatibleVersion',
          requestedContentVersion: 1,
          supportedContentVersions: [2, 3],
        },
      } as unknown as ReaderOperationDispatch),
    ).toEqual({
      kind: 'INCOMPATIBLE_VERSION',
      requestedContentVersion: 1,
      supportedContentVersions: [2, 3],
    });

    expect(
      toOutcome({
        operationId: 'op-3',
        result: {
          __typename: 'ReaderOperationAccessDenied',
          resourceId: 'res-1',
          reason: 'NO_RIGHTS',
        },
      } as unknown as ReaderOperationDispatch),
    ).toEqual({ kind: 'ACCESS_DENIED', resourceId: 'res-1', reason: 'NO_RIGHTS' });
  });

  it('converts a wire conflict copy into durable epoch-ms form', () => {
    const result: ReaderOperationDispatch = {
      operationId: 'op-1',
      result: {
        __typename: 'ReaderOperationConflict',
        kind: 'CONFLICT',
        entityId: 'hl-1',
        serverRevision: 5,
        serverValue: { __typename: 'HighlightRecord' as const, id: 'hl-1', revision: 5 },
        conflictCopy: {
          id: 'cc-1',
          operationId: 'op-1',
          sourceEntityId: 'hl-1',
          bookId: BOOK,
          contentVersion: 1,
          page: 2,
          text: 'offline edit',
          note: null,
          color: null,
          revision: 3,
          reason: 'STALE_REVISION',
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      },
    } as unknown as ReaderOperationDispatch;

    const outcome = toOutcome(result);
    expect(outcome).toMatchObject({
      kind: 'CONFLICT',
      conflictCopyId: 'cc-1',
      conflictCopy: {
        id: 'cc-1',
        operationId: 'op-1',
        sourceEntityId: 'hl-1',
        // The operation-result selection omits `anchor`; it is nulled.
        anchor: null,
        createdAt: Date.parse('2026-10-01T00:00:00.000Z'),
      },
    });
  });

  it('throws on an unknown reader operation result', () => {
    expect(() =>
      toOutcome({
        operationId: 'op-1',
        result: { __typename: 'SomethingElse' },
      } as unknown as ReaderOperationDispatch),
    ).toThrow('Unknown reader operation result');
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

/**
 * The optional coordinator seams (commitDiscard / successors / content-version
 * resolution) are DEAD IN PRODUCTION unless the REAL stores wire them. These
 * tests drive each seam end-to-end through the actual IndexedDB primitives
 * rather than injecting a fake.
 */
describe('sync-service production seam wiring', () => {
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

  function buildCoordinator(
    database: OfflineDatabase,
    overrides: Partial<ConstructorParameters<typeof SyncCoordinator>[0]> = {},
  ): SyncCoordinator {
    return new SyncCoordinator({
      store: createOutboxStore(database),
      receipts: createReceiptStore(database),
      send: jest.fn(),
      lifecycle: { getOwner: () => OWNER },
      snapshot: async () => ({ bookId: BOOK, snapshotRevision: 0, annotations: [], tombstones: [], conflictCopies: [] }),
      now: () => 1_000,
      ...overrides,
    });
  }

  it('I1: the REAL outbox store commits the discard closure atomically through commitOutboxChanges', async () => {
    const database = new OfflineDatabase();
    const base = outboxOp({ id: 'a', seq: 1, dispatchState: 'FAILED' });
    const successor = outboxOp({ id: 'b', seq: 2, dependsOn: base.id });
    await database.commitOutbox(OWNER.subject, OWNER.epoch, base);
    await database.commitOutbox(OWNER.subject, OWNER.epoch, successor);

    const commitSpy = jest.spyOn(database, 'commitOutboxChanges');
    const coordinator = buildCoordinator(database);

    const discarded = await coordinator.discardConflicts();

    expect(discarded).toBe(1);
    // The real store routed through the atomic DB primitive, not sequential
    // `remove` fallbacks.
    expect(commitSpy).toHaveBeenCalledTimes(1);
    const [, , , removeIds] = commitSpy.mock.calls[0];
    expect([...removeIds].sort()).toEqual([base.id, successor.id]);
    // The whole dependent chain is gone: no orphaned successor with a stale base.
    expect(await database.getAllByIndex('outbox', 'subject', OWNER.subject)).toHaveLength(0);
  });

  it('I4: the REAL receipt store forwards successors so their base revision rebases in the same commit', async () => {
    const database = new OfflineDatabase();
    const create = outboxOp({ id: 'create', seq: 1, kind: 'ANNOTATION_CREATE', dependsOn: null, baseRevision: null });
    const update = outboxOp({ id: 'update', seq: 2, dependsOn: create.id, baseRevision: 1 });
    await database.commitOutbox(OWNER.subject, OWNER.epoch, create);
    await database.commitOutbox(OWNER.subject, OWNER.epoch, update);

    const ackSpy = jest.spyOn(database, 'acknowledgeOperation');
    const send = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'APPLIED' as const, entityId: 'server-1', revision: 7, receiptId: 'r1' })
      .mockRejectedValueOnce(new Error('Failed to fetch'));
    const coordinator = buildCoordinator(database, { send });

    const result = await coordinator.drain();
    expect(result.summary.applied).toBe(1);

    // The 5th argument (rebased successor) was actually forwarded to the atomic
    // primitive, not dropped.
    expect(ackSpy).toHaveBeenCalledTimes(1);
    const successors = ackSpy.mock.calls[0][4] ?? [];
    expect(successors).toHaveLength(1);
    expect((successors[0] as OutboxOperationRecord).baseRevision).toBe(7);

    // And the durable successor was rebased in the same commit that removed the
    // predecessor (it remains queued only because its own dispatch then failed).
    const rows = await database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', OWNER.subject);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(update.id);
    expect(rows[0].baseRevision).toBe(7);
  });

  it('I3: the REAL resolver dispatches the snapshot-resolved version, never the fabricated 1', async () => {
    const database = new OfflineDatabase();
    // An ONLINE, never-downloaded book: no active version, no projected rows.
    const edit = outboxOp({ id: 'edit', seq: 1, contentVersion: 1, bookId: BOOK });
    await database.commitOutbox(OWNER.subject, OWNER.epoch, edit);

    const snapshot = jest.fn(async () => ({
      bookId: BOOK,
      snapshotRevision: 3,
      annotations: [
        {
          id: 'server-1',
          kind: 'ANNOTATION' as const,
          clientEntityId: 'client-1',
          revision: 2,
          deletedAt: null,
          data: { contentVersion: 5, page: 1, text: 'server', note: null, color: null, anchor: null },
        },
      ],
      tombstones: [],
      conflictCopies: [],
    }));
    const send = jest.fn(async () => ({ kind: 'APPLIED' as const, entityId: 'server-1', revision: 2, receiptId: 'r1' }));
    const coordinator = buildCoordinator(database, {
      send,
      snapshot,
      resolveContentVersion: createContentVersionResolver(database, snapshot),
    });

    await coordinator.drain();

    const sent = send.mock.calls[0][0] as { contentVersion: number };
    expect(sent.contentVersion).toBe(5);
    // The durable operation is never mutated by dispatch-time resolution.
    const rows = await database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', OWNER.subject);
    if (rows.length > 0) expect(rows[0].contentVersion).toBe(1);
  });

  it('I3: a locally downloaded active version is preferred over the snapshot', async () => {
    const database = new OfflineDatabase();
    await database.putDownloadRecord(OWNER.subject, OWNER.epoch, 'bookVersions', {
      id: qualifyKey(OWNER.subject, 'bookversion', BOOK, 9),
      subject: OWNER.subject,
      bookId: BOOK,
      contentVersion: 9,
      status: 'READY',
      active: true,
      title: 'Downloaded',
      author: null,
      description: null,
      coverAssetId: null,
      totalPages: 1,
      toc: [],
      provenance: 'test',
      createdAt: 1,
    });
    const edit = outboxOp({ id: 'edit', seq: 1, contentVersion: 1, bookId: BOOK });
    await database.commitOutbox(OWNER.subject, OWNER.epoch, edit);

    const send = jest.fn(async () => ({ kind: 'APPLIED' as const, entityId: 'server-1', revision: 2, receiptId: 'r1' }));
    const snapshot = jest.fn();
    const coordinator = buildCoordinator(database, {
      send,
      snapshot,
      resolveContentVersion: createContentVersionResolver(database, snapshot as never),
    });

    await coordinator.drain();

    expect((send.mock.calls[0][0] as { contentVersion: number }).contentVersion).toBe(9);
    // No network snapshot was needed for a locally downloaded book.
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('NEW-1: a projected server annotation does not force localOnly>0 / fullyDrained=false', async () => {
    const database = new OfflineDatabase();
    // A book with REMAINING outbox work (an unrelated pending edit) plus a
    // server annotation projected by a snapshot refresh.
    await database.commitOutbox(OWNER.subject, OWNER.epoch, outboxOp({ id: 'pending', seq: 1, entityKey: 'other-entity' }));
    const store = createSnapshotStore(database);
    await store.applyMerge(OWNER, mergeResult({
      annotations: [
        serverAnnotation({
          id: 'server-hl-1',
          clientEntityId: 'client-hl-1',
          revision: 4,
          data: { contentVersion: 2, page: 3, text: 'cross-device', note: null, color: null, anchor: null, createdAt: 1, updatedAt: 1 },
        }),
      ],
    }));

    const counter = createLocalOnlyCounter(database);
    // The projected server row is server-confirmed, not local-only work.
    expect(await counter(OWNER.subject)).toBe(0);

    const coordinator = buildCoordinator(database, { countLocalOnly: counter });
    const report = await coordinator.controlledDrain();
    // Only the real pending outbox op blocks; the barrier reflects exactly the
    // genuinely-local work.
    expect(report.localOnly).toBe(0);
    expect(report.pending).toBe(1);
  });

  it('NEW-1: a server row still under a local pending edit is NOT marked synced', async () => {
    const database = new OfflineDatabase();
    const store = createSnapshotStore(database);
    await store.applyMerge(OWNER, mergeResult({
      annotations: [
        serverAnnotation({
          id: 'server-hl-1',
          clientEntityId: 'client-hl-1',
          revision: 2,
          data: { contentVersion: 1, page: 1, text: 'local-pending', note: null, color: null, anchor: null, createdAt: 1, updatedAt: 1 },
        }),
      ],
      pending: [
        {
          operationId: 'op-update',
          kind: 'ANNOTATION_UPDATE',
          entityId: null,
          clientEntityId: 'client-hl-1',
          baseRevision: 1,
          payload: { clientEntityId: 'client-hl-1' },
        },
      ],
    }));

    const row = await database.get<HighlightRecord>(
      'readerRecords',
      qualifyKey(OWNER.subject, 'highlight', 'client-hl-1'),
    );
    expect(row?.syncedAt ?? null).toBeNull();
    expect(await createLocalOnlyCounter(database)(OWNER.subject)).toBe(1);
  });

  it('projects bookmark payloads (page/label/color/anchor) into durable readerRecords', async () => {
    const database = new OfflineDatabase();
    const store = createSnapshotStore(database);

    await store.applyMerge(OWNER, mergeResult({
      annotations: [
        {
          id: 'server-bm-1',
          kind: 'BOOKMARK',
          clientEntityId: 'client-bm-1',
          revision: 2,
          deletedAt: null,
          data: {
            contentVersion: 1,
            page: 9,
            label: 'Chapter Two',
            color: '#ff0',
            anchor: { page: 9 },
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
    }));

    const rows = await database.getAllByIndex<{ id: string; page: number; label: string | null }>(
      'readerRecords',
      'subjectBook',
      [OWNER.subject, BOOK],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ page: 9, label: 'Chapter Two' });
    expect(rows[0].id).toBe(qualifyKey(OWNER.subject, 'bookmark', 'client-bm-1'));
  });

  it('falls back to a valid contentVersion and bookId page when a merged row omits them', async () => {
    const database = new OfflineDatabase();
    const store = createSnapshotStore(database);

    await store.applyMerge(OWNER, mergeResult({
      annotations: [
        {
          id: 'client-hl-9',
          kind: 'ANNOTATION',
          clientEntityId: null,
          revision: 1,
          deletedAt: null,
          data: { page: Number.NaN, text: 'no version' },
        },
      ],
    }));

    const row = await database.get<{ contentVersion: number; page: number; text: string; syncedAt: number | null }>(
      'readerRecords',
      qualifyKey(OWNER.subject, 'highlight', 'client-hl-9'),
    );
    expect(row).toMatchObject({ contentVersion: 1, page: 1, text: 'no version' });
  });

  it('reads local annotations back into the merge view with server identity', async () => {
    const database = new OfflineDatabase();
    await database.putAccountRecord(OWNER.subject, OWNER.epoch, 'readerRecords', {
      id: qualifyKey(OWNER.subject, 'highlight', 'server-1'),
      subject: OWNER.subject,
      clientEntityId: 'client-1',
      serverEntityId: 'server-1',
      bookId: BOOK,
      contentVersion: 1,
      page: 1,
      text: 'merged',
      note: null,
      color: null,
      anchor: null,
      revision: 4,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      syncedAt: 1,
    });

    const reader = createLocalAnnotationReader(database);
    const annotations = await reader(OWNER.subject, BOOK);
    expect(annotations).toHaveLength(1);
    // A row whose server identity differs from its client id keeps the client id
    // for dependency matching and reports the server id as the stable identity.
    expect(annotations[0]).toMatchObject({
      id: 'server-1',
      kind: 'ANNOTATION',
      clientEntityId: 'client-1',
      revision: 4,
    });
  });

  it('resolves the content version from projected server records when no active download exists', async () => {
    const database = new OfflineDatabase();
    await database.putAccountRecord(OWNER.subject, OWNER.epoch, 'readerRecords', {
      id: qualifyKey(OWNER.subject, 'highlight', 'server-1'),
      subject: OWNER.subject,
      clientEntityId: 'client-1',
      serverEntityId: 'server-1',
      bookId: BOOK,
      contentVersion: 6,
      page: 1,
      text: 'projected',
      note: null,
      color: null,
      anchor: null,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      syncedAt: 1,
    });

    const resolver = createContentVersionResolver(database);
    const resolved = await resolver(OWNER, outboxOp({ id: 'edit', seq: 1 }));
    expect(resolved).toBe(6);
  });

  it('leaves the stored version untouched when every source is unknown', async () => {
    const database = new OfflineDatabase();
    const resolver = createContentVersionResolver(database);
    expect(await resolver(OWNER, outboxOp({ id: 'edit', seq: 1 }))).toBeNull();
  });

  it('resolves a version from the authoritative snapshot when local sources are silent', async () => {
    const database = new OfflineDatabase();
    const snapshot = jest.fn(async () => ({
      bookId: BOOK,
      snapshotRevision: 1,
      annotations: [
        {
          id: 'server-1',
          kind: 'ANNOTATION' as const,
          clientEntityId: null,
          revision: 1,
          deletedAt: null,
          data: { contentVersion: 4 },
        },
      ],
      tombstones: [],
      conflictCopies: [],
    }));

    const resolver = createContentVersionResolver(database, snapshot);
    expect(await resolver(OWNER, outboxOp({ id: 'edit', seq: 1 }))).toBe(4);
  });

  it('falls through to null when the snapshot lookup faults', async () => {
    const database = new OfflineDatabase();
    const snapshot = jest.fn().mockRejectedValue(new Error('offline'));
    const resolver = createContentVersionResolver(database, snapshot);
    expect(await resolver(OWNER, outboxOp({ id: 'edit', seq: 1 }))).toBeNull();
  });
});
