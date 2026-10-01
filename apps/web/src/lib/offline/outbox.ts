import type { AccountOwner } from './contracts';

/**
 * Durable outbox operation. Every field required by the Task 10 brief is
 * present: owner (`subject` + lifecycle `epoch`), `operationId`, `entityKey`,
 * local `seq` (sequence), `dependsOn` (dependency), `baseRevision`, original
 * `contentVersion`, `payload`, and `dispatchState`.
 *
 * `dispatchState` tracks how far an operation has travelled:
 * - `PENDING` — committed locally, never sent. Progress in this state is the
 *   only thing that may be coalesced.
 * - `DISPATCHING`/`DISPATCHED` — handed to the network; its id and payload are
 *   immutable across retries and it is never coalesced.
 * - `FAILED` — a dispatch attempt failed; retained immutably for retry.
 *
 * No server acknowledgement / receipts are applied here — that is Task 11.
 */
export interface OutboxOperationRecord {
  /** Local primary key (subject-namespaced). */
  readonly id: string;
  readonly subject: string;
  /** Lifecycle epoch captured when the operation was queued. */
  readonly epoch: number;
  readonly operationId: string;
  /** Groups operations for one entity so dependencies can be ordered. */
  readonly entityKey: string;
  readonly bookId: string;
  readonly contentVersion: number;
  readonly kind: OutboxOperationKind;
  /** Local `seq`; strictly increasing per account. */
  readonly seq: number;
  /** Preceding operation id this one must wait for (e.g. create → update). */
  readonly dependsOn: string | null;
  readonly baseRevision: number | null;
  readonly dispatchState: OutboxDispatchState;
  readonly attemptCount: number;
  /**
   * Advisory durable backoff scheduling metadata (wall-clock ms). Kept OUT of
   * `payload` so a retry delay can never leak into the dispatched server input.
   */
  readonly nextAttemptAt?: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
}

export type OutboxOperationKind =
  | 'PROGRESS_SET'
  | 'BOOKMARK_ADD'
  | 'BOOKMARK_REMOVE'
  | 'ANNOTATION_CREATE'
  | 'ANNOTATION_UPDATE'
  | 'ANNOTATION_DELETE';

export type OutboxDispatchState = 'PENDING' | 'DISPATCHING' | 'DISPATCHED' | 'FAILED';

export class OutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxError';
  }
}

export function dispatchStateOf(operation: OutboxOperationRecord): OutboxDispatchState {
  return operation.dispatchState;
}

/**
 * Only a progress operation that has never left this device may be coalesced.
 * Once dispatched (or failed after a dispatch attempt) the operation is retained
 * with its immutable id/payload across retries.
 */
export function isCoalescable(operation: OutboxOperationRecord): boolean {
  return operation.kind === 'PROGRESS_SET' && operation.dispatchState === 'PENDING';
}

export type CoalesceDecision =
  | { readonly action: 'REPLACE'; readonly operation: OutboxOperationRecord }
  | { readonly action: 'APPEND' };

/**
 * Coalesces a newer local progress value into an existing unsent progress
 * operation by keeping the original local id/operationId and replacing only the
 * payload. When nothing coalescable exists, the caller appends.
 */
export function coalesceProgress(
  existing: OutboxOperationRecord | null,
  newer: OutboxOperationRecord,
): CoalesceDecision {
  if (!existing || !isCoalescable(existing) || !isCoalescable(newer)) return { action: 'APPEND' };
  return {
    action: 'REPLACE',
    operation: {
      ...existing,
      payload: newer.payload,
      createdAt: newer.createdAt,
    },
  };
}

/**
 * Orders operations by local sequence so predecessors run first. Ordering alone
 * does not unblock a dependent; see `activeOperations`.
 */
export function orderForDispatch(
  operations: readonly OutboxOperationRecord[],
): OutboxOperationRecord[] {
  return [...operations].sort((a, b) => a.seq - b.seq);
}

/**
 * The runnable head at this moment: operations with no dependency, or whose
 * dependency is no longer in the outbox (it was acknowledged). An edit queued
 * after an in-flight create therefore stays parked until that create is gone.
 */
export function activeOperations(
  operations: readonly OutboxOperationRecord[],
): OutboxOperationRecord[] {
  const present = new Set(operations.map((operation) => operation.id));
  return operations.filter((operation) => operation.dependsOn === null || !present.has(operation.dependsOn));
}

/** Next local sequence for a fresh operation (1 when the outbox is empty). */
export function nextLocalSequence(operations: readonly OutboxOperationRecord[]): number {
  return operations.reduce((max, operation) => Math.max(max, operation.seq), 0) + 1;
}

/**
 * The most recent unsent progress operation for an entity, if any. Used to
 * decide whether a new progress write coalesces or appends.
 */
export function pendingProgressFor(
  operations: readonly OutboxOperationRecord[],
  entityKey: string,
): OutboxOperationRecord | null {
  const matching = operations.filter(
    (operation) => operation.entityKey === entityKey && isCoalescable(operation),
  );
  if (matching.length === 0) return null;
  return matching.reduce((latest, operation) => (operation.seq > latest.seq ? operation : latest));
}

/** The set of operation ids still queued for an entity (dependency sources). */
export function queuedOperationsFor(
  operations: readonly OutboxOperationRecord[],
  entityKey: string,
): OutboxOperationRecord[] {
  return operations.filter((operation) => operation.entityKey === entityKey);
}

/** True when an operation's owner still matches the active account. */
export function belongsToOwner(operation: OutboxOperationRecord, owner: AccountOwner): boolean {
  return operation.subject === owner.subject && operation.epoch === owner.epoch;
}

/**
 * True when `operation` is a successor whose dependency is still queued, so it
 * must wait. When the dependency has been acknowledged (removed) the successor
 * becomes runnable. Shared by the coordinator and the controlled-drain report so
 * both agree on what "blocked" means.
 */
export function isBlockedSuccessor(
  operation: OutboxOperationRecord,
  presentOperationIds: ReadonlySet<string>,
): boolean {
  return operation.dependsOn !== null && presentOperationIds.has(operation.dependsOn);
}

/**
 * A successor operation whose dependency was acknowledged. Its base revision is
 * advanced to the acknowledged revision; the payload is returned UNCHANGED.
 */
export function advanceSuccessorRevision(
  successor: OutboxOperationRecord,
  ackRevision: number,
): OutboxOperationRecord {
  return { ...successor, baseRevision: ackRevision };
}
