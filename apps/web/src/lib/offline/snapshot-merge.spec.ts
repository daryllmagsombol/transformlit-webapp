import {
  mergeSnapshot,
  pendingFromOperations,
  pendingIsPreserved,
  presentAnnotations,
  snapshotWatermarkAdvanced,
  type AuthoritativeSnapshot,
  type MergeAnnotation,
  type MergePendingOperation,
} from './snapshot-merge';
import type { ConflictCopyRecord } from './contracts';

const BOOK = 'book-1';

function annotation(overrides: Partial<MergeAnnotation> & { id: string }): MergeAnnotation {
  return {
    kind: 'ANNOTATION',
    clientEntityId: null,
    revision: 1,
    deletedAt: null,
    data: {},
    ...overrides,
  };
}

function snapshot(overrides: Partial<AuthoritativeSnapshot> = {}): AuthoritativeSnapshot {
  return {
    bookId: BOOK,
    snapshotRevision: 0,
    annotations: [],
    tombstones: [],
    conflictCopies: [],
    ...overrides,
  };
}

function pending(overrides: Partial<MergePendingOperation> & { operationId: string }): MergePendingOperation {
  return {
    kind: 'ANNOTATION_UPDATE',
    entityId: null,
    clientEntityId: null,
    baseRevision: null,
    payload: {},
    ...overrides,
  };
}

function conflictCopy(id: string, revision: number): ConflictCopyRecord {
  return {
    id,
    subject: 'subject-a',
    operationId: 'op-1',
    sourceEntityId: 'hl-1',
    bookId: BOOK,
    contentVersion: 1,
    page: 1,
    text: 'offline',
    note: null,
    color: null,
    anchor: null,
    revision,
    reason: 'STALE_REVISION',
    createdAt: 1,
  };
}

describe('mergeSnapshot', () => {
  it('keeps the server value when there is no pending local work and the server is newer', () => {
    const result = mergeSnapshot({
      snapshot: snapshot({ annotations: [annotation({ id: 'hl-1', revision: 5, data: { text: 'server' } })] }),
      local: [annotation({ id: 'hl-1', revision: 3, data: { text: 'local' } })],
      pending: [],
    });
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].revision).toBe(5);
    expect(result.annotations[0].data).toEqual({ text: 'server' });
  });

  it('lets a pending local update survive an older snapshot value', () => {
    const result = mergeSnapshot({
      snapshot: snapshot({ annotations: [annotation({ id: 'hl-1', revision: 2, data: { text: 'server' } })] }),
      local: [annotation({ id: 'hl-1', revision: 1, data: { text: 'offline edit' } })],
      pending: [pending({ operationId: 'op-a', kind: 'ANNOTATION_UPDATE', entityId: 'hl-1', baseRevision: 1 })],
    });
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].data).toEqual({ text: 'offline edit' });
  });

  it('lets a pending local create survive a server tombstone for the same client identity', () => {
    const result = mergeSnapshot({
      snapshot: snapshot({
        tombstones: [{ entityId: 'hl-1', kind: 'ANNOTATION', revision: 4, deletedAt: 10 }],
      }),
      local: [annotation({ id: 'local-1', clientEntityId: 'client-1', revision: 1, data: { text: 'pending create' } })],
      pending: [pending({ operationId: 'op-b', kind: 'ANNOTATION_CREATE', clientEntityId: 'client-1' })],
    });
    expect(result.annotations.map((row) => row.id)).toContain('local-1');
    expect(result.tombstones.map((row) => row.entityId)).toContain('hl-1');
  });

  it('retains a server deletion as a tombstone and prunes a matching idle local record', () => {
    const result = mergeSnapshot({
      snapshot: snapshot({
        tombstones: [{ entityId: 'bm-1', kind: 'BOOKMARK', revision: 3, deletedAt: 10 }],
      }),
      local: [annotation({ id: 'bm-1', kind: 'BOOKMARK', revision: 2 })],
      pending: [],
    });
    expect(result.annotations.some((row) => row.id === 'bm-1')).toBe(false);
    expect(result.tombstones).toEqual([
      { entityId: 'bm-1', kind: 'BOOKMARK', revision: 3, deletedAt: 10 },
    ]);
  });

  it('keeps a pending local delete authoritative and records its tombstone', () => {
    // A local delete is represented as a record with `deletedAt` set plus a
    // pending `*_DELETE` operation; it must survive a fresher server snapshot.
    const result = mergeSnapshot({
      snapshot: snapshot({ annotations: [annotation({ id: 'hl-1', revision: 9, data: { text: 'server' } })] }),
      local: [annotation({ id: 'hl-1', revision: 5, deletedAt: 20, data: { text: 'local' } })],
      pending: [pending({ operationId: 'op-del', kind: 'ANNOTATION_DELETE', entityId: 'hl-1', baseRevision: 5 })],
    });
    const merged = result.annotations.find((row) => row.id === 'hl-1');
    expect(merged?.deletedAt).toBe(20);
    expect(result.tombstones.map((row) => row.entityId)).toContain('hl-1');
    expect(result.pending[0].kind).toBe('ANNOTATION_DELETE');
  });

  it('never mutates pending base revisions or payloads', () => {
    const operation = pending({
      operationId: 'op-c',
      kind: 'ANNOTATION_UPDATE',
      entityId: 'hl-1',
      baseRevision: 7,
      payload: { text: 'queued', anchor: { version: 1, page: 1, startOffset: 0, endOffset: 3 } },
    });
    const result = mergeSnapshot({
      snapshot: snapshot({ annotations: [annotation({ id: 'hl-1', revision: 9, data: { text: 'server' } })] }),
      local: [annotation({ id: 'hl-1', revision: 6, data: { text: 'local' } })],
      pending: [operation],
    });
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]).toBe(operation);
    expect(result.pending[0].baseRevision).toBe(7);
    expect(result.pending[0].payload).toEqual(operation.payload);
  });

  it('keeps a local record absent from the snapshot rather than treating absence as deletion', () => {
    const result = mergeSnapshot({
      snapshot: snapshot({ annotations: [] }),
      local: [annotation({ id: 'hl-local', revision: 1, data: { text: 'only local' } })],
      pending: [],
    });
    expect(result.annotations.map((row) => row.id)).toEqual(['hl-local']);
  });

  it('includes conflict copies with their current server revision', () => {
    const result = mergeSnapshot({
      snapshot: snapshot({ conflictCopies: [conflictCopy('cc-1', 4)] }),
      local: [],
      pending: [],
    });
    expect(result.conflictCopies).toHaveLength(1);
    expect(result.conflictCopies[0]).toMatchObject({ id: 'cc-1', revision: 4 });
  });

  it('never merges progress into the annotation result', () => {
    const result = mergeSnapshot({
      snapshot: snapshot({ annotations: [annotation({ id: 'hl-1' })] }),
      local: [],
      pending: [pending({ operationId: 'op-p', kind: 'PROGRESS_SET', baseRevision: 0, payload: { currentPage: 9 } })],
    });
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations.some((row) => row.kind === 'PROGRESS')).toBe(false);
  });
});

describe('snapshotWatermarkAdvanced', () => {
  it('is true only when the watermark advances past the last applied revision', () => {
    expect(snapshotWatermarkAdvanced(snapshot({ snapshotRevision: 5 }), 4)).toBe(true);
    expect(snapshotWatermarkAdvanced(snapshot({ snapshotRevision: 5 }), 5)).toBe(false);
  });

  it('is a weak hint: a false result does not prove the snapshot is unchanged', () => {
    // The watermark is a MAX revision. A new entity at revision 1 with a
    // previously-applied watermark of 5 reports "not advanced", yet the
    // snapshot genuinely contains a change. Callers must still merge.
    const later = snapshot({
      snapshotRevision: 5,
      annotations: [annotation({ id: 'brand-new', revision: 1, data: { text: 'new' } })],
    });
    expect(snapshotWatermarkAdvanced(later, 5)).toBe(false);
    const merged = mergeSnapshot({ snapshot: later, local: [], pending: [] });
    expect(merged.annotations.map((row) => row.id)).toEqual(['brand-new']);
  });
});

describe('presentAnnotations', () => {
  it('filters out soft-deleted rows', () => {
    const rows = [annotation({ id: 'a', deletedAt: null }), annotation({ id: 'b', deletedAt: 5 })];
    expect(presentAnnotations(rows).map((row) => row.id)).toEqual(['a']);
  });
});

describe('pending projection for snapshot refresh', () => {
  it('projects outbox operations and preserves them by reference through a merge', () => {
    const payload = { clientEntityId: 'client-1', text: 'offline' };
    const operations = [
      { operationId: 'op-1', kind: 'ANNOTATION_CREATE' as const, baseRevision: null, payload },
    ];
    const pending = pendingFromOperations(operations);
    expect(pending[0]).toMatchObject({ operationId: 'op-1', clientEntityId: 'client-1', baseRevision: null });
    // Never a copy of the payload: the merge must see the same reference.
    expect(pending[0].payload).toBe(payload);

    const result = mergeSnapshot({
      snapshot: snapshot({ annotations: [annotation({ id: 'server-1', revision: 9 })] }),
      local: [],
      pending,
    });
    expect(pendingIsPreserved(result, pending)).toBe(true);
    expect(result.pending[0].baseRevision).toBeNull();
  });
});
