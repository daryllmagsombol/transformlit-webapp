import {
  SyncCoordinator,
  classifyDispatchError,
  type CoordinatorDeps,
  type OperationOutcome,
  type OutboxStore,
  type ReceiptStore,
  type SnapshotApplyStore,
  type SnapshotSource,
} from './sync-coordinator';
import { AuthHttpError } from '../auth';
import {
  OfflineStorageError,
  qualifyKey,
  type AccountOwner,
  type LeaseRecord,
  type OutboxReceiptRecord,
} from './contracts';
import type { OutboxOperationRecord } from './outbox';
import { OfflineDatabase, resetOfflineDatabaseHandle } from './database';
import {
  createMemoryIndexedDb,
  memoryIdbKeyRange,
  type MemoryIndexedDb,
} from '../../../test/helpers/memory-indexeddb';

const OWNER: AccountOwner = { subject: 'subject-a', epoch: 4 };
const BOOK = 'book-1';

interface Harness {
  readonly store: OutboxStore & { rows: OutboxOperationRecord[] };
  readonly receipts: ReceiptStore & { rows: OutboxReceiptRecord[]; removed: string[] };
  readonly send: jest.Mock<Promise<OperationOutcome>, [unknown]>;
  readonly snapshot: jest.Mock;
  readonly snapshotStore: SnapshotApplyStore & { applied: unknown[] };
  readonly lifecycle: { owner: AccountOwner | null };
  readonly coordinator: SyncCoordinator;
  readonly clock: { value: number };
  readonly acquire: jest.Mock;
  readonly release: jest.Mock;
  readonly readLease: jest.Mock;
  readonly lease: { value: LeaseRecord | null };
}

function operation(
  overrides: Partial<OutboxOperationRecord> & { id: string; seq: number },
): OutboxOperationRecord {
  return {
    subject: OWNER.subject,
    epoch: OWNER.epoch,
    operationId: `op-${overrides.id}`,
    entityKey: 'entity-1',
    bookId: BOOK,
    contentVersion: 1,
    kind: 'ANNOTATION_UPDATE',
    dependsOn: null,
    baseRevision: 1,
    dispatchState: 'PENDING',
    attemptCount: 0,
    payload: { text: 'local' },
    createdAt: overrides.seq,
    ...overrides,
  };
}

function leaseRecord(ownerId: string, token: number, expiresAt: number): LeaseRecord {
  return { id: `sync:${OWNER.subject}`, subject: OWNER.subject, ownerId, fencingToken: token, acquiredAt: 0, expiresAt };
}

function makeHarness(overrides: Partial<CoordinatorDeps> = {}): Harness {
  const rows: OutboxOperationRecord[] = [];
  const receiptRows: OutboxReceiptRecord[] = [];
  const removed: string[] = [];
  const store: OutboxStore & { rows: OutboxOperationRecord[] } = {
    rows,
    list: jest.fn(async (subject: string) => rows.filter((row) => row.subject === subject)),
    remove: jest.fn(async (id: string) => {
      removed.push(id);
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    }),
    update: jest.fn(async (row: OutboxOperationRecord) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index >= 0) rows[index] = row;
    }),
  };
  // Mirrors production `acknowledgeOperation`: the COMPLETE receipt shape is
  // stored and the operation removed in one atomic step.
  const receipts: ReceiptStore & { rows: OutboxReceiptRecord[]; removed: string[] } = {
    rows: receiptRows,
    removed,
    recordAndRemove: jest.fn(async (outboxId: string, _subject: string, _epoch: number, receipt: OutboxReceiptRecord) => {
      receiptRows.push(receipt);
      removed.push(outboxId);
      const index = rows.findIndex((row) => row.id === outboxId);
      if (index >= 0) rows.splice(index, 1);
    }),
    recordRetained: jest.fn(async (_subject: string, _epoch: number, receipt: OutboxReceiptRecord) => {
      receiptRows.push(receipt);
    }),
  };
  const send = jest.fn<Promise<OperationOutcome>, [unknown]>();
  const snapshot = jest.fn(async () => ({
    bookId: BOOK,
    snapshotRevision: 1,
    annotations: [],
    tombstones: [],
    conflictCopies: [],
  }));
  const snapshotStore: SnapshotApplyStore & { applied: unknown[] } = {
    applied: [],
    applyMerge: jest.fn(async (_owner: AccountOwner, result: unknown) => {
      snapshotStore.applied.push(result);
    }),
  };
  const lifecycle: { owner: AccountOwner | null } = { owner: OWNER };
  const clock = { value: 1_000 };
  const lease: { value: LeaseRecord | null } = { value: leaseRecord('tab-1', 1, Number.MAX_SAFE_INTEGER) };
  const acquire = jest.fn(async () => ({ acquired: true, ownerId: 'tab-1', lease: lease.value }));
  const release = jest.fn(async () => undefined);
  const readLease = jest.fn(async () => lease.value);

  const coordinator = new SyncCoordinator({
    store,
    receipts,
    send,
    lifecycle: { getOwner: () => lifecycle.owner },
    snapshot: snapshot as unknown as SnapshotSource,
    snapshotStore,
    lock: { acquire, release, readLease },
    now: () => clock.value,
    baseBackoffMs: 10,
    maxBackoffMs: 40,
    ...overrides,
  });

  return { store, receipts, send, snapshot, snapshotStore, lifecycle, coordinator, clock, acquire, release, readLease, lease };
}

describe('classifyDispatchError', () => {
  it('separates auth-required, access-denied, conflict, incompatible-version and transient', () => {
    expect(classifyDispatchError(new AuthHttpError(401))).toBe('AUTH_REQUIRED');
    expect(classifyDispatchError({ status: 403 })).toBe('ACCESS_DENIED');
    expect(classifyDispatchError({ status: 409 })).toBe('CONFLICT');
    expect(classifyDispatchError({ status: 422 })).toBe('INCOMPATIBLE_VERSION');
    expect(classifyDispatchError(new Error('Failed to fetch'))).toBe('TRANSIENT');
  });

  it('classifies storage failures distinctly and never as transient', () => {
    expect(classifyDispatchError(new OfflineStorageError('quota'))).toBe('STORAGE_FAILURE');
    expect(classifyDispatchError(new DOMException('quota', 'QuotaExceededError'))).toBe('STORAGE_FAILURE');
  });

  it('treats a fetch/abort DOMException as transient, NOT a storage fault', () => {
    // A user/fetch AbortError is a cancelled network request and must remain
    // retryable; only genuine storage faults are STORAGE_FAILURE.
    expect(classifyDispatchError(new DOMException('aborted', 'AbortError'))).toBe('TRANSIENT');
  });
});

describe('SyncCoordinator', () => {
  it('refuses to dispatch without a verified matching subject', async () => {
    const harness = makeHarness();
    harness.lifecycle.owner = null;
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));

    const result = await harness.coordinator.drain();

    expect(harness.send).not.toHaveBeenCalled();
    expect(result.blockedReason).toBe('NO_OWNER');
  });

  it('stores a COMPLETE receipt (id + subject) and removes only that operation on APPLIED', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'create', seq: 1, kind: 'ANNOTATION_CREATE', dependsOn: null, baseRevision: null }),
    );
    harness.send.mockResolvedValue({ kind: 'APPLIED', entityId: 'server-1', revision: 1, receiptId: 'r1' });

    await harness.coordinator.drain();

    // The receipt must carry `id` and `subject` so production
    // `acknowledgeOperation`'s subject guard accepts it and the `receipts`
    // keyPath ('id') has a key. This drives the real recordAndRemove path.
    expect(harness.receipts.recordAndRemove).toHaveBeenCalledWith(
      'create',
      OWNER.subject,
      OWNER.epoch,
      expect.objectContaining({
        id: expect.any(String),
        subject: OWNER.subject,
        operationId: 'op-create',
        entityId: 'server-1',
        revision: 1,
        resultKind: 'APPLIED',
      }),
      [],
    );
    expect(harness.store.rows).toHaveLength(0);
  });

  it('advances a successor base revision only after its intended create is acknowledged', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'create', seq: 1, kind: 'ANNOTATION_CREATE', dependsOn: null, baseRevision: null, entityKey: 'entity-1' }),
      operation({ id: 'update', seq: 2, kind: 'ANNOTATION_UPDATE', dependsOn: 'create', baseRevision: 1, entityKey: 'entity-1' }),
    );
    harness.send
      .mockResolvedValueOnce({ kind: 'APPLIED', entityId: 'server-1', revision: 3, receiptId: 'r1' })
      .mockResolvedValueOnce({ kind: 'APPLIED', entityId: 'server-1', revision: 4, receiptId: 'r2' });

    await harness.coordinator.drain();

    const sent = harness.send.mock.calls.map((call) => call[0] as { entityId?: string; baseRevision?: number });
    expect(sent[1]).toMatchObject({ baseRevision: 3 });
    expect(harness.store.rows).toHaveLength(0);
  });

  it('does not advance a successor when the predecessor conflicts, and pauses that entity', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'create', seq: 1, kind: 'ANNOTATION_CREATE', dependsOn: null, baseRevision: null, entityKey: 'entity-1' }),
      operation({ id: 'update', seq: 2, kind: 'ANNOTATION_UPDATE', dependsOn: 'create', baseRevision: 1, entityKey: 'entity-1' }),
      operation({ id: 'other', seq: 3, kind: 'BOOKMARK_ADD', dependsOn: null, baseRevision: null, entityKey: 'entity-2' }),
    );
    harness.send
      .mockResolvedValueOnce({ kind: 'CONFLICT', entityId: 'server-1', serverRevision: 5, conflictCopyId: 'cc-1' })
      .mockResolvedValueOnce({ kind: 'APPLIED', entityId: 'bm-1', revision: 1, receiptId: 'r2' });

    await harness.coordinator.drain();

    const sentIds = harness.send.mock.calls.map((call) => (call[0] as { operationId: string }).operationId);
    expect(sentIds).toEqual(['op-create', 'op-other']);
    // The conflicted create is retained (terminal until state changes) and its
    // successor stays blocked.
    expect(harness.store.rows.map((row) => row.id).sort()).toEqual(['create', 'update']);
  });

  it('replays an uncertain in-flight operation with its original ID and payload', async () => {
    const harness = makeHarness();
    const inFlight = operation({ id: 'inflight', seq: 1, dispatchState: 'DISPATCHING', payload: { text: 'original' } });
    harness.store.rows.push(inFlight);
    harness.send.mockResolvedValue({ kind: 'APPLIED', entityId: 'server-1', revision: 2, receiptId: 'r1' });

    await harness.coordinator.drain();

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect((harness.send.mock.calls[0][0] as { operationId: string }).operationId).toBe('op-inflight');
    // The flattened envelope carries payload fields at the top level and never
    // a nested `payload` object (absent from ReaderOperationInput).
    expect((harness.send.mock.calls[0][0] as { text: string }).text).toBe('original');
    expect((harness.send.mock.calls[0][0] as { payload?: unknown }).payload).toBeUndefined();
  });

  it('processes operations in strict per-entity sequence order', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'b', seq: 2, entityKey: 'entity-1', kind: 'BOOKMARK_REMOVE', baseRevision: 1 }),
      operation({ id: 'a', seq: 1, entityKey: 'entity-1', kind: 'BOOKMARK_ADD', baseRevision: null }),
      operation({ id: 'c', seq: 3, entityKey: 'entity-2', kind: 'BOOKMARK_ADD', baseRevision: null }),
    );
    harness.send.mockResolvedValue({ kind: 'APPLIED', entityId: 'x', revision: 1, receiptId: 'r' });

    await harness.coordinator.drain();

    const sentIds = harness.send.mock.calls.map((call) => (call[0] as { operationId: string }).operationId);
    expect(sentIds).toEqual(['op-a', 'op-b', 'op-c']);
  });

  it('classifies transient failures, increments attempts and leaves the op queued', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockRejectedValue(new Error('Failed to fetch'));

    const result = await harness.coordinator.drain();

    expect(result.summary.transient).toBe(1);
    expect(harness.store.rows).toHaveLength(1);
    expect(harness.store.rows[0].dispatchState).toBe('PENDING');
    expect(harness.store.rows[0].attemptCount).toBe(1);
  });

  it('classifies access-denied distinctly and retains the op (terminal until state changes)', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockResolvedValue({ kind: 'ACCESS_DENIED', resourceId: BOOK, reason: 'no access' });

    const result = await harness.coordinator.drain();

    expect(result.summary.accessDenied).toBe(1);
    expect(harness.store.rows).toHaveLength(1);
  });

  it('classifies incompatible-version distinctly', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockResolvedValue({ kind: 'INCOMPATIBLE_VERSION', requestedContentVersion: 1, supportedContentVersions: [2] });

    const result = await harness.coordinator.drain();

    expect(result.summary.incompatibleVersion).toBe(1);
    expect(harness.store.rows).toHaveLength(1);
  });

  it('ignores a stale result after the account owner changes mid-flight', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockImplementation(async () => {
      harness.lifecycle.owner = { subject: 'subject-b', epoch: 9 };
      return { kind: 'APPLIED', entityId: 'server-1', revision: 2, receiptId: 'r1' };
    });

    await harness.coordinator.drain();

    expect(harness.receipts.recordAndRemove).not.toHaveBeenCalled();
    expect(harness.store.rows).toHaveLength(1);
  });

  it('deduplicates concurrent drain calls into a single run', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    let release: (value: OperationOutcome) => void = () => {};
    harness.send.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = harness.coordinator.drain();
    const second = harness.coordinator.drain();
    release({ kind: 'APPLIED', entityId: 'server-1', revision: 2, receiptId: 'r1' });
    await Promise.all([first, second]);

    expect(harness.send).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when the coordination lease is not acquired (another tab owns sync)', async () => {
    const harness = makeHarness();
    harness.acquire.mockResolvedValue({ acquired: false, ownerId: 'other-tab' });
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));

    const result = await harness.coordinator.drain();

    expect(harness.send).not.toHaveBeenCalled();
    expect(result.blockedReason).toBe('LEASE_HELD');
  });

  it('discards an acknowledgement when the lease fencing token is lost mid-flight, leaving the op replayable', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockImplementation(async () => {
      // Another tab took over the lease (new fencing token) while this request
      // was in flight; the local TTL has NOT expired, so only the token proves it.
      harness.lease.value = leaseRecord('tab-2', 2, Number.MAX_SAFE_INTEGER);
      return { kind: 'APPLIED', entityId: 'server-1', revision: 2, receiptId: 'r1' };
    });

    const result = await harness.coordinator.drain();

    expect(harness.receipts.recordAndRemove).not.toHaveBeenCalled();
    expect(result.summary.stale).toBe(1);
    expect(harness.store.rows).toHaveLength(1);
  });

  it('publishes an acknowledgement when the lease token is still held after the round-trip', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockResolvedValue({ kind: 'APPLIED', entityId: 'server-1', revision: 2, receiptId: 'r1' });

    const result = await harness.coordinator.drain();

    expect(harness.receipts.recordAndRemove).toHaveBeenCalledTimes(1);
    expect(result.summary.applied).toBe(1);
    expect(harness.store.rows).toHaveLength(0);
  });

  it('classifies and surfaces an auth-required transport failure explicitly', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockRejectedValue(new AuthHttpError(401));
    const statuses: Array<{ authRequired: boolean; state: string }> = [];
    harness.coordinator.subscribe((status) => statuses.push(status));

    const result = await harness.coordinator.drain();

    expect(result.summary.authRequired).toBe(1);
    expect(statuses.some((status) => status.authRequired)).toBe(true);
    // The operation is retained for replay after reauthentication.
    expect(harness.store.rows).toHaveLength(1);
  });

  it('classifies a storage failure distinctly and never treats it as transient', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockRejectedValue(new OfflineStorageError('quota exceeded'));

    const result = await harness.coordinator.drain();

    expect(result.summary.storageFailure).toBe(1);
    expect(result.summary.transient).toBe(0);
    const status = harness.coordinator.getStatus();
    expect(status?.storageFailure).toBe(true);
  });

  it('never leaks retryDelayMs into the dispatched input and never mutates the stored payload', async () => {
    const harness = makeHarness();
    const originalPayload = { text: 'local' };
    harness.store.rows.push(operation({ id: 'a', seq: 1, payload: originalPayload }));
    harness.send.mockRejectedValueOnce(new Error('Failed to fetch'));

    await harness.coordinator.drain();

    // The retry reschedules WITHOUT touching the durable payload.
    expect(harness.store.rows[0].payload).toEqual(originalPayload);
    expect(harness.store.rows[0].payload).not.toHaveProperty('retryDelayMs');
    expect(harness.store.rows[0].nextAttemptAt).toBeGreaterThanOrEqual(harness.clock.value);
    expect((harness.send.mock.calls[0][0] as { retryDelayMs?: unknown }).retryDelayMs).toBeUndefined();

    // A later successful retry must still send the pristine payload fields.
    harness.send.mockResolvedValueOnce({ kind: 'APPLIED', entityId: 'server-1', revision: 2, receiptId: 'r1' });
    await harness.coordinator.drain();
    expect((harness.send.mock.calls[1][0] as { text: unknown }).text).toEqual('local');
    expect((harness.send.mock.calls[1][0] as { payload?: unknown }).payload).toBeUndefined();
    expect((harness.send.mock.calls[1][0] as { retryDelayMs?: unknown }).retryDelayMs).toBeUndefined();
  });

  it('retains a conflicted op (blocking successors) while recording a durable conflict receipt', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'create', seq: 1, kind: 'ANNOTATION_CREATE', dependsOn: null, baseRevision: null, entityKey: 'e1' }),
      operation({ id: 'update', seq: 2, kind: 'ANNOTATION_UPDATE', dependsOn: 'create', baseRevision: 1, entityKey: 'e1' }),
    );
    harness.send.mockResolvedValue({
      kind: 'CONFLICT',
      entityId: 'server-1',
      serverRevision: 5,
      serverValue: { id: 'server-1', revision: 5 },
      conflictCopyId: 'cc-1',
    });

    const result = await harness.coordinator.drain();

    expect(result.summary.conflict).toBe(1);
    expect(harness.receipts.recordRetained).toHaveBeenCalledWith(
      OWNER.subject,
      OWNER.epoch,
      expect.objectContaining({ id: expect.any(String), subject: OWNER.subject, resultKind: 'CONFLICT' }),
    );
    expect(harness.store.rows.map((row) => row.id).sort()).toEqual(['create', 'update']);
  });

  it('fetches, merges AND applies a snapshot for each book without losing pending work', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1, bookId: BOOK }));
    harness.send.mockRejectedValue(new Error('Failed to fetch'));
    harness.snapshot.mockResolvedValue({
      bookId: BOOK,
      snapshotRevision: 3,
      annotations: [],
      tombstones: [{ entityId: 'bm-1', kind: 'BOOKMARK', revision: 2, deletedAt: 10 }],
      conflictCopies: [],
    });

    const report = await harness.coordinator.refreshSnapshots();

    expect(harness.snapshot).toHaveBeenCalledWith(BOOK);
    expect(harness.snapshotStore.applied).toHaveLength(1);
    expect(report).toMatchObject({ books: 1, tombstones: 1 });
    // The merge result actually applied the tombstone (not discarded).
    expect(harness.snapshotStore.applied[0]).toMatchObject({ bookId: BOOK, tombstones: expect.any(Array) });
    expect(harness.store.rows).toHaveLength(1);
  });

  it('discards ONLY true conflicts on request (actionable recovery)', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'conflict', seq: 1, entityKey: 'e1', dispatchState: 'FAILED' }),
      operation({ id: 'denied', seq: 2, entityKey: 'e2', dispatchState: 'TERMINAL' }),
      operation({ id: 'incompatible', seq: 3, entityKey: 'e3', dispatchState: 'TERMINAL' }),
      operation({ id: 'pending', seq: 4, entityKey: 'e4' }),
    );

    const discarded = await harness.coordinator.discardConflicts();

    // Access-denied / incompatible-version ops were never conflicts and must
    // never be silently discarded under the "conflicts" control.
    expect(discarded).toBe(1);
    expect(harness.store.rows.map((row) => row.id).sort()).toEqual(['denied', 'incompatible', 'pending']);
  });

  it('marks an access-denied outcome TERMINAL (not a conflict) and retains it', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'denied', seq: 1 }));
    harness.send.mockResolvedValue({ kind: 'ACCESS_DENIED', resourceId: 'book-1', reason: 'no access' });

    const result = await harness.coordinator.drain();

    expect(result.summary.accessDenied).toBe(1);
    expect(harness.store.rows).toHaveLength(1);
    expect(harness.store.rows[0].dispatchState).toBe('TERMINAL');
    expect(harness.store.rows[0].terminalReason).toBe('ACCESS_DENIED');
    const status = harness.coordinator.getStatus();
    expect(status?.terminal).toBe(1);
    expect(status?.conflicts).toBe(0);
    expect(status?.accessDenied).toBe(1);
    expect(status?.incompatibleVersion).toBe(0);
  });

  it('marks an incompatible-version outcome TERMINAL (not a conflict) and retains it', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'incompatible', seq: 1 }));
    harness.send.mockResolvedValue({
      kind: 'INCOMPATIBLE_VERSION',
      requestedContentVersion: 1,
      supportedContentVersions: [2],
    });

    const result = await harness.coordinator.drain();

    expect(result.summary.incompatibleVersion).toBe(1);
    expect(harness.store.rows).toHaveLength(1);
    expect(harness.store.rows[0].dispatchState).toBe('TERMINAL');
    expect(harness.store.rows[0].terminalReason).toBe('INCOMPATIBLE_VERSION');
    const status = harness.coordinator.getStatus();
    expect(status?.terminal).toBe(1);
    expect(status?.conflicts).toBe(0);
    expect(status?.incompatibleVersion).toBe(1);
    expect(status?.accessDenied).toBe(0);
  });

  it('subscribes to status transitions and replays the latest status', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockResolvedValue({ kind: 'APPLIED', entityId: 'server-1', revision: 1, receiptId: 'r1' });
    await harness.coordinator.drain();

    const seen: string[] = [];
    const unsubscribe = harness.coordinator.subscribe((status) => seen.push(status.state));
    expect(seen).toEqual(['IDLE']);
    unsubscribe();
  });

  it('reports a controlled drain that accounts for pending, in-flight, blocked, conflict and terminal work distinctly', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'pending', seq: 1, entityKey: 'e1' }),
      operation({ id: 'inflight', seq: 2, entityKey: 'e2', dispatchState: 'DISPATCHING' }),
      operation({ id: 'blocked', seq: 3, entityKey: 'e3', dependsOn: 'pending' }),
      operation({ id: 'conflict', seq: 4, entityKey: 'e4', dispatchState: 'FAILED' }),
      operation({ id: 'denied', seq: 5, entityKey: 'e5', dispatchState: 'TERMINAL' }),
      operation({ id: 'incompatible', seq: 6, entityKey: 'e6', dispatchState: 'TERMINAL' }),
    );

    const report = await harness.coordinator.controlledDrain();

    expect(report.fullyDrained).toBe(false);
    expect(report.pending).toBeGreaterThanOrEqual(1);
    expect(report.inFlightOrUncertain).toBeGreaterThanOrEqual(1);
    expect(report.blockedSuccessors).toBeGreaterThanOrEqual(1);
    // Terminal outcomes are NOT conflicts and must not inflate the conflict
    // figure used for sign-out gating.
    expect(report.conflicts).toBe(1);
    expect(report.terminal).toBe(2);
  });

  it('reports fully drained when there is no work', async () => {
    const harness = makeHarness();
    const report = await harness.coordinator.controlledDrain();
    expect(report).toMatchObject({
      fullyDrained: true,
      pending: 0,
      inFlightOrUncertain: 0,
      blockedSuccessors: 0,
      conflicts: 0,
      terminal: 0,
      localOnly: 0,
    });
  });

  it('is NOT fully drained when local-only records exist (no outbox operation)', async () => {
    const harness = makeHarness({ countLocalOnly: async () => 2 });
    const report = await harness.coordinator.controlledDrain();
    expect(report.localOnly).toBe(2);
    expect(report.fullyDrained).toBe(false);
  });
});

/**
 * Drives the coordinator through the REAL Task 4 `OfflineDatabase`
 * acknowledgement primitive. This is the path that previously threw
 * `SubjectMismatchError` because the receipt lacked `id`/`subject`; the fake
 * ReceiptStore never exercised it.
 */
describe('SyncCoordinator over the production receipt path', () => {
  beforeAll(() => {
    if (typeof globalThis.IDBKeyRange === 'undefined') {
      Object.defineProperty(globalThis, 'IDBKeyRange', { writable: true, value: memoryIdbKeyRange });
    }
  });

  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('acknowledges and removes an operation through database.acknowledgeOperation without throwing', async () => {
    const memory: MemoryIndexedDb = createMemoryIndexedDb();
    (globalThis as { indexedDB?: unknown }).indexedDB = memory.indexedDB;
    resetOfflineDatabaseHandle();
    const database = new OfflineDatabase();
    await database.writeLifecycle({ id: 'lifecycle', state: 'ACTIVE', subject: OWNER.subject, epoch: OWNER.epoch, updatedAt: 1 });

    const row = operation({
      id: qualifyKey(OWNER.subject, 'outbox', 'create'),
      seq: 1,
      kind: 'ANNOTATION_CREATE',
      dependsOn: null,
      baseRevision: null,
    });
    await database.commitOutbox(OWNER.subject, OWNER.epoch, row);

    // Real receipt store wiring (mirrors sync-service.createReceiptStore).
    const receipts: ReceiptStore = {
      recordAndRemove: (outboxId, subject, epoch, receipt) =>
        database.acknowledgeOperation(subject, epoch, outboxId, receipt),
      recordRetained: (subject, epoch, receipt) => database.recordReceipt(subject, epoch, receipt),
    };
    const store: OutboxStore = {
      list: (subject) => database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', subject),
      remove: (id) => database.delete('outbox', id),
      update: (record) => database.putAccountRecord(record.subject, record.epoch, 'outbox', record),
    };

    const coordinator = new SyncCoordinator({
      store,
      receipts,
      send: async () => ({ kind: 'APPLIED', entityId: 'server-1', revision: 1, receiptId: 'r1' }),
      lifecycle: { getOwner: () => OWNER },
      snapshot: async () => ({ bookId: BOOK, snapshotRevision: 0, annotations: [], tombstones: [], conflictCopies: [] }),
      now: () => 1_000,
    });

    const result = await coordinator.drain();

    expect(result.summary.applied).toBe(1);
    expect(await database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', OWNER.subject)).toHaveLength(0);
    const receiptsRows = await database.getAllByIndex<OutboxReceiptRecord>('receipts', 'subject', OWNER.subject);
    expect(receiptsRows).toHaveLength(1);
    expect(receiptsRows[0]).toMatchObject({
      id: expect.any(String),
      subject: OWNER.subject,
      operationId: row.operationId,
      resultKind: 'APPLIED',
    });
  });
});
