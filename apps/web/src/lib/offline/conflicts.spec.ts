import {
  ConflictResolver,
  annotationProvenance,
  buildConflictView,
  directSuccessors,
  isConflictedOperation,
  listConflictViews,
  planOfflineCopyChoice,
  planProgressChoice,
  planRetarget,
  planServerChoice,
  progressChoicePage,
  referencedContentVersions,
  serverProgressPage,
  type ConflictPlanContext,
  type ConflictView,
  type StoredConflictCopyRecord,
} from './conflicts';
import { OfflineDatabase, resetOfflineDatabaseHandle } from './database';
import {
  isBlockedSuccessor,
  type OutboxOperationRecord,
} from './outbox';
import { qualifyKey } from './contracts';
import type { AccountOwner, OutboxReceiptRecord } from './contracts';
import { createMemoryIndexedDb, memoryIdbKeyRange, type MemoryIndexedDb } from '../../../test/helpers/memory-indexeddb';

const OWNER: AccountOwner = { subject: 'subject-a', epoch: 1 };
const BOOK = 'book-1';

function op(
  overrides: Partial<OutboxOperationRecord> & { id: string; seq: number },
): OutboxOperationRecord {
  return {
    subject: OWNER.subject,
    epoch: OWNER.epoch,
    operationId: `op-${overrides.id}`,
    entityKey: qualifyKey(OWNER.subject, 'highlight', 'client-1'),
    bookId: BOOK,
    contentVersion: 7,
    kind: 'ANNOTATION_UPDATE',
    dependsOn: null,
    baseRevision: 2,
    dispatchState: 'PENDING',
    attemptCount: 0,
    payload: { entityId: 'server-1', page: 1, text: 'offline edit', note: null, color: null, anchor: null },
    createdAt: overrides.seq,
    ...overrides,
    // Outbox keys are always subject-namespaced; `overrides.id` is the logical id.
    id: qualifyKey(OWNER.subject, 'outbox', overrides.id),
  };
}

function conflicted(id: string, overrides: Partial<OutboxOperationRecord> = {}): OutboxOperationRecord {
  return op({
    id,
    seq: 1,
    dispatchState: 'FAILED',
    kind: 'ANNOTATION_UPDATE',
    baseRevision: 2,
    payload: { entityId: 'server-1', page: 1, text: 'offline edit', note: 'mine', color: null, anchor: { version: 1, page: 1, startOffset: 0, endOffset: 5 } },
    ...overrides,
  });
}

function copy(overrides: Partial<StoredConflictCopyRecord> = {}): StoredConflictCopyRecord {
  return {
    id: qualifyKey(OWNER.subject, 'conflict', 'cc-1'),
    serverId: 'cc-1',
    subject: OWNER.subject,
    operationId: 'op-a',
    sourceEntityId: 'server-1',
    bookId: BOOK,
    contentVersion: 7,
    page: 1,
    text: 'offline edit',
    note: 'mine',
    color: null,
    anchor: { version: 1, page: 1, startOffset: 0, endOffset: 5 },
    revision: 3,
    reason: 'STALE_REVISION',
    createdAt: 1,
    ...overrides,
  };
}

function context(newId: () => string, now = 1000): ConflictPlanContext {
  return { subject: OWNER.subject, epoch: OWNER.epoch, now, newId };
}

describe('conflict views', () => {
  it('keeps the operation, server and conflict-copy identities/payloads available', () => {
    const operations = [conflicted('a')];
    const views = listConflictViews(operations, [copy()], [], {
      'op-a': { revision: 9, value: { id: 'server-1', text: 'server edit', revision: 9 } },
    });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      operationId: 'op-a',
      sourceEntityId: 'server-1',
      serverRevision: 9,
      serverValue: { id: 'server-1', text: 'server edit', revision: 9 },
      offlineEdit: { text: 'offline edit', note: 'mine' },
    });
    expect(views[0].conflictCopy).toMatchObject({ serverId: 'cc-1', revision: 3, reason: 'STALE_REVISION' });
    expect(views[0].reason).toBe('STALE_REVISION');
  });

  it('excludes TERMINAL (access-denied/incompatible) operations from conflicts', () => {
    const terminal = op({ id: 't', seq: 2, dispatchState: 'TERMINAL' });
    expect(isConflictedOperation(terminal)).toBe(false);
    expect(listConflictViews([terminal], [], [])).toHaveLength(0);
  });

  it('falls back to the durable conflict receipt for the server revision', () => {
    const receipts: OutboxReceiptRecord[] = [
      {
        id: qualifyKey(OWNER.subject, 'receipt', 'op-a'),
        subject: OWNER.subject,
        operationId: 'op-a',
        entityId: 'server-1',
        revision: 11,
        resultKind: 'CONFLICT',
        acknowledgedAt: 1,
      },
    ];
    const view = buildConflictView(conflicted('a'), [conflicted('a')], [copy()], receipts);
    expect(view.serverRevision).toBe(11);
  });

  it('lists successors that stay paused until resolution', () => {
    const base = conflicted('a');
    const successor = op({ id: 'b', seq: 2, dependsOn: base.id, baseRevision: 2 });
    const operations = [base, successor];
    const present = new Set(operations.map((o) => o.id));
    expect(isBlockedSuccessor(successor, present)).toBe(true);
    expect(directSuccessors(operations, base.id)).toHaveLength(1);
    expect(listConflictViews(operations, [], [])[0].successorOperationIds).toEqual(['op-b']);
  });
});

describe('resolution plans', () => {
  const base = conflicted('a');
  const successor = op({ id: 'b', seq: 2, dependsOn: base.id, baseRevision: 2, contentVersion: 7 });
  const descendant = op({ id: 'c', seq: 3, dependsOn: successor.id, baseRevision: 2 });

  function view(): ConflictView {
    return listConflictViews([base, successor, descendant], [copy()], [])[0];
  }

  it('accepts the server record by removing the edit and rebasing successors', () => {
    const plan = planServerChoice(view(), [base, successor, descendant], 9);
    expect(plan.removeIds).toEqual([base.id]);
    expect(plan.enqueuedOperationIds).toEqual([]);
    const rebased = plan.upserts.find((u) => u.id === successor.id);
    expect(rebased?.baseRevision).toBe(9);
    // Payload/provenance untouched by a server choice.
    expect(rebased?.payload).toEqual(successor.payload);
    expect(rebased?.contentVersion).toBe(7);
  });

  it('retargets ONLY the intended successors and preserves dependencies/provenance', () => {
    const sibling = op({ id: 's', seq: 4, entityKey: qualifyKey(OWNER.subject, 'highlight', 'other'), dependsOn: base.id });
    const operations = [base, successor, descendant, sibling];
    const conflict = listConflictViews(operations, [copy()], [])[0];

    const plan = planRetarget(conflict, operations, copy(), [successor.operationId], context(() => 'new-1'));

    expect(plan.removeIds).toEqual([base.id, successor.id]);
    expect(plan.enqueuedOperationIds).toEqual(['new-1']);
    const retargeted = plan.upserts.find((u) => u.operationId === 'new-1');
    expect(retargeted).toMatchObject({
      kind: 'ANNOTATION_UPDATE',
      baseRevision: 3,
      seq: successor.seq,
      dependsOn: successor.dependsOn,
      contentVersion: 7,
      dispatchState: 'PENDING',
    });
    expect(retargeted?.payload).toMatchObject({
      entityId: 'cc-1',
      targetKind: 'CONFLICT_COPY',
      baseRevision: 3,
      text: 'offline edit',
    });
    // The descendant now depends on the retargeted op; the unrelated sibling is untouched.
    const rebound = plan.upserts.find((u) => u.id === descendant.id);
    expect(rebound?.dependsOn).toBe(retargeted?.id);
    expect(plan.upserts.some((u) => u.id === sibling.id)).toBe(false);
  });

  it('keeps the offline copy by retargeting every direct successor', () => {
    const operations = [base, successor, descendant];
    const conflict = listConflictViews(operations, [copy()], [])[0];
    const plan = planOfflineCopyChoice(conflict, operations, copy(), context(() => 'new-1'));
    expect(plan.enqueuedOperationIds).toEqual(['new-1']);
    expect(plan.upserts.some((u) => u.operationId === 'new-1')).toBe(true);
  });

  it('resolves progress to the LOCAL page (no highest-page-wins) as a new replay-safe op', () => {
    const progressBase = conflicted('p', {
      kind: 'PROGRESS_SET',
      entityKey: qualifyKey(OWNER.subject, 'progress', BOOK),
      contentVersion: 7,
      baseRevision: 4,
      payload: { currentPage: 2, scrollY: null },
    });
    const conflict = listConflictViews([progressBase], [], [], {
      'op-p': { revision: 4, value: { currentPage: 40, revision: 4 } },
    })[0];

    const plan = planProgressChoice(conflict, [progressBase], 'LOCAL', 4, context(() => 'new-p'));
    const appended = plan.upserts[0];
    expect(plan.removeIds).toEqual([progressBase.id]);
    expect(appended).toMatchObject({
      kind: 'PROGRESS_SET',
      contentVersion: 7,
      baseRevision: 4,
      dispatchState: 'PENDING',
    });
    expect(appended.payload).toEqual({ currentPage: 2, scrollY: null });
  });

  it('resolves progress to the SERVER position without appending an operation', () => {
    const progressBase = conflicted('p', {
      kind: 'PROGRESS_SET',
      entityKey: qualifyKey(OWNER.subject, 'progress', BOOK),
      payload: { currentPage: 2, scrollY: null },
    });
    const conflict = listConflictViews([progressBase], [], [])[0];
    const plan = planProgressChoice(conflict, [progressBase], 'SERVER', 4, context(() => 'new-p'));
    expect(plan.removeIds).toEqual([progressBase.id]);
    expect(plan.upserts).toHaveLength(0);
  });
});

describe('progress choice resolution', () => {
  function progressConflict(serverValue: Record<string, unknown> | null): ConflictView {
    return listConflictViews([conflicted('p', {
      kind: 'PROGRESS_SET',
      entityKey: qualifyKey(OWNER.subject, 'progress', BOOK),
      payload: { currentPage: 2, scrollY: null },
    })], [], [], { 'op-p': { revision: 4, value: serverValue } })[0];
  }

  it('exposes the local or server resume page for an explicit choice', () => {
    const conflict = progressConflict({ currentPage: 40, revision: 4 });
    expect(progressChoicePage(conflict, 'LOCAL')).toBe(2);
    expect(progressChoicePage(conflict, 'SERVER')).toBe(40);
  });

  it('reports an unknown server page as null so the SERVER control can be disabled', () => {
    const conflict = progressConflict(null);
    expect(serverProgressPage(conflict)).toBeNull();
    expect(progressChoicePage(conflict, 'SERVER')).toBeNull();
    expect(progressChoicePage(conflict, 'LOCAL')).toBe(2);
  });
});

describe('content-version provenance', () => {
  it('marks an annotation pinned while its version is available, unresolved otherwise', () => {
    expect(annotationProvenance({ contentVersion: 7 }, [7, 8])).toBe('PINNED');
    expect(annotationProvenance({ contentVersion: 6 }, [7, 8])).toBe('UNRESOLVED_CONTENT_VERSION');
  });

  it('collects versions still referenced by saved records and pending operations', () => {
    expect(referencedContentVersions(
      [{ contentVersion: 3 }, { contentVersion: 3 }],
      [{ contentVersion: 5 }, { contentVersion: undefined }],
    )).toEqual([3, 5]);
  });
});

describe('ConflictResolver over durable state', () => {
  let memory: MemoryIndexedDb;
  let database: OfflineDatabase;

  beforeAll(() => {
    if (typeof globalThis.IDBKeyRange === 'undefined') {
      Object.defineProperty(globalThis, 'IDBKeyRange', { writable: true, value: memoryIdbKeyRange });
    }
  });

  beforeEach(async () => {
    memory = createMemoryIndexedDb();
    (globalThis as { indexedDB?: unknown }).indexedDB = memory.indexedDB;
    resetOfflineDatabaseHandle();
    database = new OfflineDatabase();
    await database.writeLifecycle({
      id: 'lifecycle',
      state: 'ACTIVE',
      subject: OWNER.subject,
      epoch: OWNER.epoch,
      updatedAt: 1,
    });
  });

  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  function resolver(): ConflictResolver {
    let counter = 0;
    return new ConflictResolver({
      database,
      getOwner: () => OWNER,
      now: () => 1000,
      newId: () => `new-${(counter += 1)}`,
    });
  }

  async function seed(operations: OutboxOperationRecord[], copies: StoredConflictCopyRecord[] = []): Promise<void> {
    for (const operation of operations) {
      await database.commitOutbox(OWNER.subject, OWNER.epoch, operation);
    }
    for (const record of copies) {
      await database.putAccountRecord(OWNER.subject, OWNER.epoch, 'conflicts', record);
    }
  }

  async function listOutbox(): Promise<OutboxOperationRecord[]> {
    return database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', OWNER.subject);
  }

  it('chooseServer removes the conflicted op, rebases successors and marks the copy resolved', async () => {
    const base = conflicted('a');
    const successor = op({ id: 'b', seq: 2, dependsOn: base.id, baseRevision: 2 });
    await seed([base, successor], [copy()]);
    const conflict = (await resolver().listConflicts(BOOK, { 'op-a': { revision: 9, value: null } }))[0];

    const result = await resolver().chooseServer(conflict);

    expect(result.status).toBe('RESOLVED');
    const rows = await listOutbox();
    expect(rows.map((row) => row.operationId).sort()).toEqual(['op-b']);
    expect(rows[0].baseRevision).toBe(9);
    const copies = await database.getAllByIndex<StoredConflictCopyRecord>('conflicts', 'subject', OWNER.subject);
    expect(copies[0].resolution).toBe('SERVER');
  });

  it('keepOfflineCopy removes the conflicted op and appends a retargeted successor', async () => {
    const base = conflicted('a');
    const successor = op({ id: 'b', seq: 2, dependsOn: base.id, baseRevision: 2 });
    await seed([base, successor], [copy()]);
    const conflict = (await resolver().listConflicts(BOOK))[0];

    const result = await resolver().keepOfflineCopy(conflict);

    expect(result.status).toBe('RESOLVED');
    expect(result.enqueuedOperationIds).toEqual(['new-1']);
    const rows = await listOutbox();
    expect(rows.map((row) => row.operationId).sort()).toEqual(['new-1']);
    expect(rows[0].payload).toMatchObject({ targetKind: 'CONFLICT_COPY', entityId: 'cc-1' });
  });

  it('retargets only the intended successor', async () => {
    const base = conflicted('a');
    const intended = op({ id: 'b', seq: 2, dependsOn: base.id, baseRevision: 2 });
    const sibling = op({ id: 's', seq: 3, dependsOn: base.id, entityKey: qualifyKey(OWNER.subject, 'highlight', 'other') });
    await seed([base, intended, sibling], [copy()]);
    const conflict = (await resolver().listConflicts(BOOK))[0];

    const result = await resolver().retarget(conflict, [intended.operationId]);

    expect(result.enqueuedOperationIds).toEqual(['new-1']);
    const rows = await listOutbox();
    expect(rows.some((row) => row.id === sibling.id)).toBe(true);
    expect(rows).toHaveLength(2); // retargeted op + untouched sibling
  });

  it('commits the resolution atomically: a mid-transaction fault cannot lose the retargeted successor, and it is retryable', async () => {
    const base = conflicted('a');
    const successor = op({ id: 'b', seq: 2, dependsOn: base.id, baseRevision: 2 });
    await seed([base, successor], [copy()]);
    const conflict = (await resolver().listConflicts(BOOK))[0];

    // Fault while writing the retargeted CONFLICT_COPY operation (upserts are
    // written before removals, so the removal must not have happened).
    memory.failPutWhen(
      (store, value) =>
        store === 'outbox' &&
        (value as { payload?: { targetKind?: string } }).payload?.targetKind === 'CONFLICT_COPY',
    );

    const failed = await resolver().keepOfflineCopy(conflict);
    expect(failed.status).toBe('FAILED');

    // Content survived: the conflicted op AND its successor are still present,
    // and the conflict copy is still unresolved.
    const afterFault = await listOutbox();
    expect(afterFault.map((row) => row.operationId).sort()).toEqual(['op-a', 'op-b']);
    const copiesAfterFault = await database.getAllByIndex<StoredConflictCopyRecord>(
      'conflicts',
      'subject',
      OWNER.subject,
    );
    expect(copiesAfterFault[0].resolution ?? null).toBeNull();

    // Retry succeeds and replaces the successor with the retargeted operation.
    memory.clearFailures();
    const retried = await resolver().keepOfflineCopy(conflict);
    expect(retried.status).toBe('RESOLVED');
    expect(retried.enqueuedOperationIds).toEqual(['new-1']);
    const rows = await listOutbox();
    expect(rows.map((row) => row.operationId).sort()).toEqual(['new-1']);
    const resolvedCopies = await database.getAllByIndex<StoredConflictCopyRecord>(
      'conflicts',
      'subject',
      OWNER.subject,
    );
    expect(resolvedCopies[0].resolution).toBe('OFFLINE_COPY');
  });

  it('resolves progress locally with a lower local page but never with an implicit maximum', async () => {
    const progressBase = conflicted('p', {
      kind: 'PROGRESS_SET',
      entityKey: qualifyKey(OWNER.subject, 'progress', BOOK),
      contentVersion: 7,
      baseRevision: 4,
      payload: { currentPage: 2, scrollY: null },
    });
    await seed([progressBase]);
    const conflict = (await resolver().listConflicts(BOOK, {
      'op-p': { revision: 4, value: { currentPage: 40, revision: 4 } },
    }))[0];

    const result = await resolver().resolveProgress(conflict, 'LOCAL');

    expect(result.status).toBe('RESOLVED');
    const rows = await listOutbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'PROGRESS_SET', baseRevision: 4, contentVersion: 7 });
    expect(rows[0].payload).toEqual({ currentPage: 2, scrollY: null });
  });

  it('applies an offline DELETE decision as a new replay-safe delete (local delete vs server edit)', async () => {
    const deleteBase = conflicted('d', {
      kind: 'ANNOTATION_DELETE',
      entityKey: qualifyKey(OWNER.subject, 'highlight', 'client-d'),
      payload: { entityId: 'server-d', baseRevision: 5 },
    });
    await seed(
      [deleteBase],
      [copy({ operationId: 'op-d', sourceEntityId: 'server-d', serverId: 'cc-d', reason: 'DELETE_VS_EDIT', text: 'server edit' })],
    );
    const conflict = (await resolver().listConflicts(BOOK, {
      'server-d': { revision: 9, value: { id: 'server-d', text: 'server edit', revision: 9 } },
    }))[0];

    const keep = await resolver().keepOfflineCopy(conflict);

    expect(keep.status).toBe('RESOLVED');
    const rows = await listOutbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'ANNOTATION_DELETE', baseRevision: 9, contentVersion: 7 });
    expect(rows[0].payload).toMatchObject({ entityId: 'server-d', baseRevision: 9 });
  });

  it('accepts the server on a local-delete conflict without losing deletion history', async () => {
    const deleteBase = conflicted('d', {
      kind: 'ANNOTATION_DELETE',
      entityKey: qualifyKey(OWNER.subject, 'highlight', 'client-d'),
      payload: { entityId: 'server-d', baseRevision: 5 },
    });
    await seed(
      [deleteBase],
      [copy({ operationId: 'op-d', sourceEntityId: 'server-d', serverId: 'cc-d', reason: 'DELETE_VS_EDIT' })],
    );
    const conflict = (await resolver().listConflicts(BOOK, {
      'server-d': { revision: 9, value: { id: 'server-d', text: 'server edit', revision: 9 } },
    }))[0];

    const server = await resolver().chooseServer(conflict);

    expect(server.status).toBe('RESOLVED');
    // The delete intent is dropped; the server edit stands and the copy is
    // durably recorded as resolved (deletion history is not silently lost).
    expect(await listOutbox()).toHaveLength(0);
    const copies = await database.getAllByIndex<StoredConflictCopyRecord>('conflicts', 'subject', OWNER.subject);
    expect(copies[0].resolution).toBe('SERVER');
  });

  it('surfaces both directions of a delete/edit race without losing either payload', async () => {
    const editVsDelete = conflicted('e', {
      kind: 'ANNOTATION_UPDATE',
      payload: { entityId: 'server-1', page: 1, text: 'my edit', note: null, color: null, anchor: null },
    });
    const deleteVsEdit = conflicted('d', {
      kind: 'ANNOTATION_DELETE',
      payload: { entityId: 'server-2', baseRevision: 5 },
    });
    const views = listConflictViews(
      [editVsDelete, deleteVsEdit],
      [
        copy({ id: qualifyKey(OWNER.subject, 'conflict', 'cc-edit'), serverId: 'cc-edit', operationId: 'op-e', reason: 'DELETE_VS_EDIT', text: 'my edit' }),
        copy({ id: qualifyKey(OWNER.subject, 'conflict', 'cc-delete'), serverId: 'cc-delete', operationId: 'op-d', reason: 'STALE_REVISION', sourceEntityId: 'server-2', text: 'server content' }),
      ],
      [],
    );
    expect(views.map((v) => v.reason).sort()).toEqual(['DELETE_VS_EDIT', 'STALE_REVISION']);
    expect(views.find((v) => v.operationId === 'op-e')?.offlineEdit).toMatchObject({ text: 'my edit' });
    expect(views.find((v) => v.operationId === 'op-e')?.conflictCopy?.text).toBe('my edit');
    expect(views.find((v) => v.operationId === 'op-d')?.conflictCopy?.text).toBe('server content');
  });

  it('rejects resolving a conflict that no longer exists', async () => {
    const stale = listConflictViews([conflicted('a')], [copy()], [])[0];
    const result = await resolver().chooseServer(stale);
    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/already resolved|no longer/i);
  });
});
