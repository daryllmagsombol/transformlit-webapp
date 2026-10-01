import {
  SyncCoordinator,
  classifyDispatchError,
  type CoordinatorDeps,
  type OperationOutcome,
  type OutboxStore,
  type ReceiptStore,
  type SnapshotSource,
} from './sync-coordinator';
import { AuthHttpError } from '../auth';
import type { AccountOwner } from './contracts';
import type { OutboxOperationRecord } from './outbox';

const OWNER: AccountOwner = { subject: 'subject-a', epoch: 4 };
const BOOK = 'book-1';

interface Harness {
  readonly store: OutboxStore & { rows: OutboxOperationRecord[] };
  readonly receipts: ReceiptStore & { rows: Record<string, unknown>[] };
  readonly send: jest.Mock<Promise<OperationOutcome>, [unknown]>;
  readonly snapshot: jest.Mock;
  readonly lifecycle: { owner: AccountOwner | null };
  readonly coordinator: SyncCoordinator;
  readonly clock: { value: number };
  readonly acquire: jest.Mock;
  readonly release: jest.Mock;
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

function makeHarness(overrides: Partial<CoordinatorDeps> = {}): Harness {
  const rows: OutboxOperationRecord[] = [];
  const receiptRows: Record<string, unknown>[] = [];
  const store: OutboxStore & { rows: OutboxOperationRecord[] } = {
    rows,
    list: jest.fn(async (subject: string) => rows.filter((row) => row.subject === subject)),
    remove: jest.fn(async (id: string) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    }),
    update: jest.fn(async (row: OutboxOperationRecord) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index >= 0) rows[index] = row;
    }),
  };
  const receipts: ReceiptStore & { rows: Record<string, unknown>[] } = {
    rows: receiptRows,
    record: jest.fn(async (record: Record<string, unknown>) => {
      receiptRows.push(record);
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
  const lifecycle: { owner: AccountOwner | null } = { owner: OWNER };
  const clock = { value: 1_000 };
  const acquire = jest.fn(async () => ({ acquired: true, ownerId: 'tab-1' }));
  const release = jest.fn(async () => undefined);

  const coordinator = new SyncCoordinator({
    store,
    receipts,
    send,
    lifecycle: { getOwner: () => lifecycle.owner },
    snapshot: snapshot as unknown as SnapshotSource,
    lock: { acquire, release },
    now: () => clock.value,
    baseBackoffMs: 10,
    maxBackoffMs: 40,
    ...overrides,
  });

  return { store, receipts, send, snapshot, lifecycle, coordinator, clock, acquire, release };
}

describe('classifyDispatchError', () => {
  it('separates auth-required, access-denied, conflict, incompatible-version and transient', () => {
    expect(classifyDispatchError(new AuthHttpError(401))).toBe('AUTH_REQUIRED');
    expect(classifyDispatchError({ status: 403 })).toBe('ACCESS_DENIED');
    expect(classifyDispatchError({ status: 409 })).toBe('CONFLICT');
    expect(classifyDispatchError({ status: 422 })).toBe('INCOMPATIBLE_VERSION');
    expect(classifyDispatchError(new Error('Failed to fetch'))).toBe('TRANSIENT');
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

  it('stores a create receipt and removes only that operation on APPLIED', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'create', seq: 1, kind: 'ANNOTATION_CREATE', dependsOn: null, baseRevision: null }),
    );
    harness.send.mockResolvedValue({ kind: 'APPLIED', entityId: 'server-1', revision: 1, receiptId: 'r1' });

    await harness.coordinator.drain();

    expect(harness.receipts.record).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-create', entityId: 'server-1', revision: 1, resultKind: 'APPLIED' }),
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
    expect((harness.send.mock.calls[0][0] as { payload: unknown }).payload).toEqual({ text: 'original' });
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

    expect(harness.receipts.record).not.toHaveBeenCalled();
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

  it('discards an acknowledgement when the lease expired mid-flight, leaving the op replayable', async () => {
    const harness = makeHarness({ leaseTtlMs: 50 });
    harness.store.rows.push(operation({ id: 'a', seq: 1 }));
    harness.send.mockImplementation(async () => {
      // Time advances beyond the TTL while the request is in flight.
      harness.clock.value += 10_000;
      return { kind: 'APPLIED', entityId: 'server-1', revision: 2, receiptId: 'r1' };
    });

    const result = await harness.coordinator.drain();

    expect(harness.receipts.record).not.toHaveBeenCalled();
    expect(result.summary.stale).toBe(1);
    expect(harness.store.rows).toHaveLength(1);
  });

  it('fetches and merges a snapshot for each book with pending work without losing the work', async () => {
    const harness = makeHarness();
    harness.store.rows.push(operation({ id: 'a', seq: 1, bookId: BOOK }));
    harness.send.mockRejectedValue(new Error('Failed to fetch'));

    await harness.coordinator.refreshSnapshots();

    expect(harness.snapshot).toHaveBeenCalledWith(BOOK);
    expect(harness.store.rows).toHaveLength(1);
  });

  it('reports a controlled drain that accounts for pending, in-flight, blocked, and conflict work', async () => {
    const harness = makeHarness();
    harness.store.rows.push(
      operation({ id: 'pending', seq: 1, entityKey: 'e1' }),
      operation({ id: 'inflight', seq: 2, entityKey: 'e2', dispatchState: 'DISPATCHING' }),
      operation({ id: 'blocked', seq: 3, entityKey: 'e3', dependsOn: 'pending' }),
      operation({ id: 'conflict', seq: 4, entityKey: 'e4', dispatchState: 'FAILED' }),
    );

    const report = await harness.coordinator.controlledDrain();

    expect(report.fullyDrained).toBe(false);
    expect(report.pending).toBeGreaterThanOrEqual(1);
    expect(report.inFlightOrUncertain).toBeGreaterThanOrEqual(1);
    expect(report.blockedSuccessors).toBeGreaterThanOrEqual(1);
    expect(report.conflicts).toBeGreaterThanOrEqual(1);
  });

  it('reports fully drained when there is no work', async () => {
    const harness = makeHarness();
    const report = await harness.coordinator.controlledDrain();
    expect(report).toMatchObject({ fullyDrained: true, pending: 0, inFlightOrUncertain: 0, blockedSuccessors: 0, conflicts: 0 });
  });
});
