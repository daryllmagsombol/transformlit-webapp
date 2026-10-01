import {
  OutboxError,
  activeOperations,
  coalesceProgress,
  dispatchStateOf,
  incompatibleVersionOperations,
  isCoalescable,
  nextLocalSequence,
  orderForDispatch,
  type OutboxOperationRecord,
} from './outbox';
import type { AccountOwner } from './contracts';

const OWNER: AccountOwner = { subject: 'subject-a', epoch: 1 };
const BOOK = 'book-1';

function operation(overrides: Partial<OutboxOperationRecord> & { id: string; seq: number }): OutboxOperationRecord {
  return {
    subject: OWNER.subject,
    epoch: OWNER.epoch,
    operationId: `op-${overrides.id}`,
    entityKey: BOOK,
    bookId: BOOK,
    contentVersion: 1,
    kind: 'PROGRESS_SET',
    dependsOn: null,
    baseRevision: 0,
    dispatchState: 'PENDING',
    attemptCount: 0,
    payload: { currentPage: 1, scrollY: null },
    createdAt: overrides.seq,
    ...overrides,
  };
}

describe('outbox dispatch state', () => {
  it('treats PENDING operations as coalescable progress and coalesces only pre-dispatch', () => {
    const pending = operation({ id: 'p1', seq: 1 });
    expect(dispatchStateOf(pending)).toBe('PENDING');
    expect(isCoalescable(pending)).toBe(true);

    const failed = operation({ id: 'p2', seq: 2, dispatchState: 'FAILED' });
    // A dispatched-but-failed operation is retained immutably and never coalesced.
    expect(dispatchStateOf(failed)).toBe('FAILED');
    expect(isCoalescable(failed)).toBe(false);
  });

  it('never coalesces a non-progress operation', () => {
    expect(isCoalescable(operation({ id: 'b1', seq: 1, kind: 'BOOKMARK_ADD' }))).toBe(false);
  });

  it('coalesces a newer unsent progress op into the existing unsent one, keeping the original id/payload immutable otherwise', () => {
    const existing = operation({ id: 'p1', seq: 1, payload: { currentPage: 3, scrollY: null } });
    const newer = operation({ id: 'p2', seq: 2, payload: { currentPage: 9, scrollY: 40 } });
    const result = coalesceProgress(existing, newer);
    expect(result.action).toBe('REPLACE');
    if (result.action === 'REPLACE') {
      expect(result.operation.id).toBe('p1');
      expect(result.operation.operationId).toBe(existing.operationId);
      expect(result.operation.payload).toEqual({ currentPage: 9, scrollY: 40 });
    }
  });

  it('appends instead of coalescing when the existing progress op was already dispatched', () => {
    const dispatched = operation({ id: 'p1', seq: 1, dispatchState: 'DISPATCHED' });
    const newer = operation({ id: 'p2', seq: 2 });
    expect(coalesceProgress(dispatched, newer)).toEqual({ action: 'APPEND' });
  });

  it('appends when no existing progress op is present', () => {
    expect(coalesceProgress(null, operation({ id: 'p1', seq: 1 }))).toEqual({ action: 'APPEND' });
  });
});

describe('outbox ordering and state', () => {
  it('orders operations by local sequence and respects dependencies within the same entity', () => {
    const created = operation({ id: 'a', seq: 1, kind: 'ANNOTATION_CREATE', dispatchState: 'DISPATCHED' });
    const edit = operation({ id: 'b', seq: 2, kind: 'ANNOTATION_UPDATE', dependsOn: 'a' });
    const otherBook = operation({ id: 'c', seq: 3, entityKey: 'book-2', bookId: 'book-2' });
    const ordered = orderForDispatch([edit, otherBook, created]);
    expect(ordered.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    // An edit after an in-flight create waits for its predecessor.
    const firstRound = activeOperations(ordered);
    expect(firstRound.map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('computes the next local sequence from existing operations', () => {
    expect(nextLocalSequence([])).toBe(1);
    expect(nextLocalSequence([operation({ id: 'a', seq: 4 }), operation({ id: 'b', seq: 9 })])).toBe(10);
  });

  it('rejects malformed operations that are not Error subclassed', () => {
    const error = new OutboxError('bad');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('OutboxError');
  });

  it('surfaces explicit incompatible-version terminal operations (not conflicts)', () => {
    const incompatible = operation({
      id: 'v',
      seq: 1,
      dispatchState: 'TERMINAL',
      terminalReason: 'INCOMPATIBLE_VERSION',
      contentVersion: 7,
    });
    const denied = operation({ id: 'd', seq: 2, dispatchState: 'TERMINAL', terminalReason: 'ACCESS_DENIED' });
    const conflict = operation({ id: 'c', seq: 3, dispatchState: 'FAILED' });

    const surfaced = incompatibleVersionOperations([incompatible, denied, conflict]);
    expect(surfaced.map((row) => row.id)).toEqual(['v']);
    // The original pending content version is preserved for recovery.
    expect(surfaced[0].contentVersion).toBe(7);
  });
});
