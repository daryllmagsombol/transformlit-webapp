import { AuthHttpError } from '../auth';
import {
  OfflineStorageError,
  receiptKey,
  type AccountOwner,
  type LeaseRecord,
  type OutboxReceiptRecord,
} from './contracts';
import type { OutboxOperationRecord } from './outbox';
import {
  accessDeniedOperations,
  advanceSuccessorRevision,
  incompatibleVersionOperations,
  isBlockedSuccessor,
  orderForDispatch,
} from './outbox';
import { leaseStillValid } from './coordination';
import {
  mergeSnapshot,
  pendingFromOperations,
  type AuthoritativeSnapshot,
  type MergeAnnotation,
  type MergeSnapshotResult,
} from './snapshot-merge';

/**
 * One bounded run outcome for a single dispatched operation. The coordinator
 * reconciles these into durable receipts / state transitions.
 */
export type OperationOutcome =
  | { readonly kind: 'APPLIED'; readonly entityId: string; readonly revision: number; readonly receiptId: string }
  | {
      readonly kind: 'CONFLICT';
      readonly entityId: string;
      readonly serverRevision: number;
      readonly serverValue: unknown;
      readonly conflictCopyId?: string | null;
    }
  | { readonly kind: 'ACCESS_DENIED'; readonly resourceId: string; readonly reason: string }
  | {
      readonly kind: 'INCOMPATIBLE_VERSION';
      readonly requestedContentVersion: number;
      readonly supportedContentVersions: readonly number[];
    };

/**
 * Transport/server failure classification, kept distinct from operation
 * outcomes. The six classes map to distinct UX: bounded retry (TRANSIENT),
 * reauthentication (AUTH_REQUIRED), permanent recovery/discard
 * (ACCESS_DENIED / INCOMPATIBLE_VERSION), user resolution (CONFLICT), and a
 * storage fault that must never be retried as a transport error
 * (STORAGE_FAILURE).
 */
export type DispatchFailure =
  | 'TRANSIENT'
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'CONFLICT'
  | 'INCOMPATIBLE_VERSION'
  | 'STORAGE_FAILURE';

export interface OutboxStore {
  list(subject: string): Promise<OutboxOperationRecord[]>;
  remove(id: string): Promise<void>;
  update(record: OutboxOperationRecord): Promise<void>;
}

/**
 * Durable receipt persistence. Both methods are REQUIRED and both are atomic
 * per-method writes guarded by subject + epoch. The receipt is a COMPLETE
 * `OutboxReceiptRecord` (id + subject), which the IndexedDB subject guard
 * validates — a partial receipt without `id`/`subject` is a hard error.
 *
 * - `recordAndRemove` stores an APPLIED receipt and removes its acknowledged
 *   operation in ONE transaction (worst case a crash leaves the op replayable,
 *   never a receipt without removal).
 * - `recordRetained` stores a CONFLICT receipt while deliberately RETAINING the
 *   operation so its successors stay blocked until the user resolves it. The
 *   server treats the operationId as idempotent, so a later replay returns the
 *   same durable conflict result.
 */
export interface ReceiptStore {
  recordAndRemove(
    outboxId: string,
    subject: string,
    epoch: number,
    receipt: OutboxReceiptRecord,
  ): Promise<void>;
  recordRetained(subject: string, epoch: number, receipt: OutboxReceiptRecord): Promise<void>;
}

export interface SnapshotSource {
  (bookId: string): Promise<AuthoritativeSnapshot>;
}

/** One book's merge result plus the book it belongs to. */
export interface BookMergeResult extends MergeSnapshotResult {
  readonly bookId: string;
}

/**
 * Applies a merged authoritative snapshot to local durable state (tombstones,
 * conflict copies, server-authoritative annotations). Optional so read-only
 * contexts can fetch and preserve without writing; when absent the merge result
 * is still returned and surfaced.
 */
export interface SnapshotApplyStore {
  applyMerge(owner: AccountOwner, result: BookMergeResult): Promise<void>;
}

export interface CoordinationLock {
  acquire(): Promise<{ readonly acquired: boolean; readonly ownerId: string; readonly lease: LeaseRecord | null }>;
  release(): Promise<void>;
  /**
   * Re-reads the current lease record so the coordinator can verify the fencing
   * token after a network round-trip. When absent, the coordinator falls back to
   * a local TTL heuristic (kept only for lock implementations that cannot expose
   * the lease).
   */
  readLease?(): Promise<LeaseRecord | null>;
}

export interface CoordinatorDeps {
  readonly store: OutboxStore;
  readonly receipts: ReceiptStore;
  /**
   * Authenticated application transport. It MUST already be authenticated
   * application code; the coordinator only invokes it after verifying the
   * caller's subject still matches the operation's owner.
   */
  readonly send: (input: unknown) => Promise<OperationOutcome>;
  readonly lifecycle: { readonly getOwner: () => AccountOwner | null };
  readonly snapshot: SnapshotSource;
  readonly snapshotStore?: SnapshotApplyStore;
  readonly lock?: CoordinationLock;
  readonly now?: () => number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly leaseTtlMs?: number;
  /** Test/observability seam: receives every summary transition. */
  readonly onStatus?: (status: CoordinatorStatus) => void;
}

export interface DrainSummary {
  applied: number;
  conflict: number;
  accessDenied: number;
  incompatibleVersion: number;
  transient: number;
  stale: number;
  storageFailure: number;
  authRequired: number;
}

export interface DrainResult {
  readonly summary: DrainSummary;
  readonly blockedReason: 'NO_OWNER' | 'LEASE_HELD' | null;
}

export interface ControlledDrainReport {
  readonly pending: number;
  readonly inFlightOrUncertain: number;
  readonly blockedSuccessors: number;
  /** TRUE conflicts only (user-resolvable edits paused by a server conflict). */
  readonly conflicts: number;
  /**
   * Non-conflict terminal outcomes (access denied / incompatible version).
   * Distinct from conflicts so they are never counted as conflicts for
   * sign-out gating nor silently discarded as one.
   */
  readonly terminal: number;
  readonly fullyDrained: boolean;
}

export interface CoordinatorStatus {
  readonly state: 'IDLE' | 'SYNCING' | 'BLOCKED' | 'ERROR';
  readonly pending: number;
  /** Durable TRUE conflicts (dispatchState `FAILED`). */
  readonly conflicts: number;
  /** Durable non-conflict terminal outcomes (dispatchState `TERMINAL`). */
  readonly terminal: number;
  /**
   * The subset of `terminal` whose content version was unavailable /
   * incompatible — surfaced distinctly from access denial so the recovery
   * message can be honest ("update the app" vs "request access").
   */
  readonly incompatibleVersion: number;
  /** The subset of `terminal` retained because access was denied. */
  readonly accessDenied: number;
  readonly authRequired: boolean;
  readonly storageFailure: boolean;
  readonly lastError: string | null;
}

/** What one snapshot refresh fetched, merged and (optionally) applied. */
export interface SnapshotRefreshResult {
  readonly books: number;
  readonly annotations: number;
  readonly tombstones: number;
  readonly conflicts: number;
}

const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 30_000;

function statusOf(error: unknown): number | null {
  if (error instanceof AuthHttpError) return error.status;
  if (error && typeof error === 'object') {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const value = candidate.status ?? candidate.statusCode;
    if (typeof value === 'number') return value;
  }
  return null;
}

/**
 * Classifies a transport/server failure. Distinct classes drive distinct UX:
 * reauthentication, permanent recovery/discard, bounded retry, or a storage
 * fault. IndexedDB/storage errors are classified FIRST and are never treated as
 * a transient network failure that would retry forever.
 */
export function classifyDispatchError(error: unknown): DispatchFailure {
  if (error instanceof OfflineStorageError) return 'STORAGE_FAILURE';
  if (isStorageDomException(error)) return 'STORAGE_FAILURE';
  const status = statusOf(error);
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'ACCESS_DENIED';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'INCOMPATIBLE_VERSION';
  return 'TRANSIENT';
}

/**
 * True for genuine storage DOMExceptions (quota / IndexedDB state faults).
 * `AbortError` is deliberately EXCLUDED: a fetch/abort-induced AbortError is a
 * cancelled network request and must fall through to TRANSIENT so it is retried,
 * not surfaced as a bogus storage fault. A real IndexedDB transaction abort is
 * wrapped as `OfflineStorageError`/`TransactionAbortedError` and is caught by
 * the first check in `classifyDispatchError`.
 */
function isStorageDomException(error: unknown): boolean {
  if (typeof DOMException === 'undefined' || !(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'InvalidStateError' ||
    error.name === 'NotFoundError'
  );
}

function emptySummary(): DrainSummary {
  return {
    applied: 0,
    conflict: 0,
    accessDenied: 0,
    incompatibleVersion: 0,
    transient: 0,
    stale: 0,
    storageFailure: 0,
    authRequired: 0,
  };
}

/**
 * Ordered, account-fenced foreground replay.
 *
 * One coordinator processes every queued operation in strict per-entity
 * sequence order, respects `dependsOn`, and reconciles acknowledgements into
 * durable receipts. It never dispatches without a verified matching subject and
 * never blocks on Background Sync.
 */
export class SyncCoordinator {
  private readonly deps: CoordinatorDeps;
  private readonly now: () => number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly leaseTtlMs: number;
  private readonly listeners = new Set<(status: CoordinatorStatus) => void>();
  private lastStatus: CoordinatorStatus | null = null;
  private inFlightDrain: Promise<DrainResult> | null = null;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  }

  /**
   * Subscribes to status transitions. The most recent status is replayed
   * immediately so a newly mounted consumer is never left without state. Returns
   * an unsubscribe function.
   */
  subscribe(listener: (status: CoordinatorStatus) => void): () => void {
    this.listeners.add(listener);
    if (this.lastStatus) listener(this.lastStatus);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The most recent emitted status, or null before the first run. */
  getStatus(): CoordinatorStatus | null {
    return this.lastStatus;
  }

  /**
   * Discards TRUE conflict operations for the current owner (the user choosing
   * to abandon a conflicting local edit). Only `dispatchState: 'FAILED'` is
   * removed; terminal non-conflict outcomes (`TERMINAL`) are retained because
   * they were never conflicts and must not be silently discarded. Returns how
   * many were removed.
   */
  async discardConflicts(): Promise<number> {
    const owner = this.deps.lifecycle.getOwner();
    if (!owner) return 0;
    const operations = await this.deps.store.list(owner.subject);
    const conflicted = operations.filter((operation) => operation.dispatchState === 'FAILED');
    for (const operation of conflicted) {
      await this.deps.store.remove(operation.id);
    }
    const remaining = operations.filter((operation) => operation.dispatchState !== 'FAILED');
    this.emitStatus('IDLE', remaining, emptySummary(), null);
    return conflicted.length;
  }

  /**
   * One bounded drain. Concurrent callers share the same run so duplicate
   * coordinators cannot dispatch the same operation twice.
   */
  drain(): Promise<DrainResult> {
    if (this.inFlightDrain) return this.inFlightDrain;
    const run = this.runDrain().finally(() => {
      if (this.inFlightDrain === run) this.inFlightDrain = null;
    });
    this.inFlightDrain = run;
    return run;
  }

  private async runDrain(): Promise<DrainResult> {
    const summary = emptySummary();
    const lifecycle = this.deps.lifecycle;
    const initialOwner = lifecycle.getOwner();
    if (!initialOwner) return this.blocked('NO_OWNER', summary);

    const lock = this.deps.lock;
    let lease: LeaseRecord | null = null;
    if (lock) {
      const acquired = await lock.acquire();
      if (!acquired.acquired) return this.blocked('LEASE_HELD', summary);
      lease = acquired.lease;
    }

    try {
      if (lifecycle.getOwner()?.subject !== initialOwner.subject) return this.blocked('NO_OWNER', summary);
      const operations = await this.deps.store.list(initialOwner.subject);
      await this.processOperations(initialOwner, orderForDispatch(operations), summary, lease);
      // Re-read the DURABLE queue for the final status: dispatch updated each
      // operation's dispatchState (PENDING/FAILED/TERMINAL), so the in-memory
      // working copy is stale for conflict/terminal counts.
      const settled = await this.deps.store.list(initialOwner.subject);
      this.emitStatus('IDLE', settled, summary, null);
      return { summary, blockedReason: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      this.emitStatus('ERROR', [], summary, message);
      throw error;
    } finally {
      if (lock) await lock.release();
    }
  }

  private async processOperations(
    owner: AccountOwner,
    ordered: readonly OutboxOperationRecord[],
    summary: DrainSummary,
    lease: LeaseRecord | null,
  ): Promise<void> {
    // Mutable working copy so a successor's advanced base revision is visible
    // when its turn comes, without mutating the persisted payload.
    const working = new Map(ordered.map((operation) => [operation.id, operation]));
    const pausedEntities = new Set<string>();

    for (const operation of ordered) {
      const current = working.get(operation.id);
      if (!current) continue;
      if (pausedEntities.has(current.entityKey)) continue;
      if (isBlockedSuccessor(current, new Set(working.keys()))) continue;
      if (this.ownerChanged(owner)) break;

      const effect = await this.dispatch(owner, current, summary, lease);
      if (effect.removed) working.delete(operation.id);
      if (effect.paused) pausedEntities.add(current.entityKey);
      if (effect.ackRevision !== null) {
        for (const [id, candidate] of working) {
          if (candidate.dependsOn === operation.id) {
            working.set(id, { ...candidate, baseRevision: effect.ackRevision });
          }
        }
      }
    }
  }

  /** Returns the reconciliation effect on the current run. */
  private async dispatch(
    owner: AccountOwner,
    operation: OutboxOperationRecord,
    summary: DrainSummary,
    lease: LeaseRecord | null,
  ): Promise<{ removed: boolean; paused: boolean; ackRevision: number | null }> {
    await this.deps.store.update({ ...operation, dispatchState: 'DISPATCHING' });

    let outcome: OperationOutcome;
    try {
      outcome = await this.deps.send(this.buildInput(operation));
    } catch (error) {
      const failure = classifyDispatchError(error);
      // A transport failure is NOT an acknowledgement: the operation keeps its
      // immutable id/payload and is retried later.
      await this.restorePending(operation);
      if (failure === 'TRANSIENT') summary.transient += 1;
      else if (failure === 'STORAGE_FAILURE') summary.storageFailure += 1;
      else this.markTerminal(failure, summary);
      return { removed: false, paused: false, ackRevision: null };
    }

    // Discard stale results: the account changed or the sync lease is no longer
    // held by this coordinator while the request was in flight. The lease is
    // re-read and its fencing token verified — a local TTL guess is not proof.
    if (this.ownerChanged(owner) || (await this.leaseLost(lease))) {
      await this.restorePending(operation);
      summary.stale += 1;
      return { removed: false, paused: false, ackRevision: null };
    }

    return this.reconcile(operation, outcome, summary);
  }

  /**
   * True when this coordinator no longer holds its lease. With a readable lease
   * the fencing token is verified authoritatively; otherwise the local TTL is a
   * best-effort fallback.
   */
  private async leaseLost(lease: LeaseRecord | null): Promise<boolean> {
    if (!lease) return false;
    const read = this.deps.lock?.readLease;
    if (read) return !leaseStillValid(await read(), lease.fencingToken, this.now());
    return this.now() - lease.acquiredAt > this.leaseTtlMs;
  }

  private async reconcile(
    operation: OutboxOperationRecord,
    outcome: OperationOutcome,
    summary: DrainSummary,
  ): Promise<{ removed: boolean; paused: boolean; ackRevision: number | null }> {
    switch (outcome.kind) {
      case 'APPLIED':
        await this.applyAck(operation, outcome);
        summary.applied += 1;
        return { removed: true, paused: false, ackRevision: outcome.revision };
      case 'CONFLICT':
        // Conflict receipts are durable, but the operation is RETAINED so its
        // successors stay blocked until the user resolves (retarget/discard).
        await this.deps.receipts.recordRetained(operation.subject, operation.epoch, {
          id: receiptKey(operation.subject, operation.operationId),
          subject: operation.subject,
          operationId: operation.operationId,
          entityId: outcome.entityId,
          revision: outcome.serverRevision,
          resultKind: 'CONFLICT',
          acknowledgedAt: this.now(),
        });
        await this.deps.store.update({ ...operation, dispatchState: 'FAILED', attemptCount: operation.attemptCount + 1 });
        summary.conflict += 1;
        return { removed: false, paused: true, ackRevision: null };
      case 'ACCESS_DENIED':
        await this.retainTerminal(operation, 'ACCESS_DENIED');
        summary.accessDenied += 1;
        return { removed: false, paused: false, ackRevision: null };
      case 'INCOMPATIBLE_VERSION':
        await this.retainTerminal(operation, 'INCOMPATIBLE_VERSION');
        summary.incompatibleVersion += 1;
        return { removed: false, paused: false, ackRevision: null };
      default:
        return { removed: false, paused: false, ackRevision: null };
    }
  }

  /**
   * Applies an acknowledgement ATOMICALLY: a COMPLETE `OutboxReceiptRecord`
   * (id + subject) is stored and the acknowledged operation removed in one
   * transaction. Successors on the SAME entity then have their base revision
   * advanced to the ack revision (payload untouched).
   */
  private async applyAck(
    operation: OutboxOperationRecord,
    outcome: Extract<OperationOutcome, { kind: 'APPLIED' }>,
  ): Promise<void> {
    const receipt: OutboxReceiptRecord = {
      id: receiptKey(operation.subject, operation.operationId),
      subject: operation.subject,
      operationId: operation.operationId,
      entityId: outcome.entityId,
      revision: outcome.revision,
      resultKind: 'APPLIED',
      acknowledgedAt: this.now(),
    };
    await this.deps.receipts.recordAndRemove(operation.id, operation.subject, operation.epoch, receipt);

    // Advance ONLY the successor's base revision; never its payload.
    const siblings = await this.deps.store.list(operation.subject);
    for (const sibling of siblings) {
      if (sibling.dependsOn !== operation.id) continue;
      await this.deps.store.update(advanceSuccessorRevision(sibling, outcome.revision));
    }
  }

  /**
   * Retains a terminal-but-re-evaluable operation (ACCESS_DENIED /
   * INCOMPATIBLE_VERSION). The contracts deliberately record NO receipt for
   * these outcomes: they are terminal only until user/account/content state
   * changes, so a later replay must be re-evaluated rather than frozen. The
   * operation stays queued immutably and is marked `TERMINAL` — a state distinct
   * from conflict `FAILED`, so it is never offered as "discard conflicting
   * changes" nor counted as a conflict.
   */
  private async retainTerminal(
    operation: OutboxOperationRecord,
    terminalReason: 'ACCESS_DENIED' | 'INCOMPATIBLE_VERSION',
  ): Promise<void> {
    await this.deps.store.update({
      ...operation,
      dispatchState: 'TERMINAL',
      terminalReason,
      attemptCount: operation.attemptCount + 1,
    });
  }

  /**
   * Reschedules a failed operation WITHOUT mutating its durable payload. Backoff
   * is durable scheduling metadata (`nextAttemptAt`), never a payload field, so
   * the dispatched input can never leak `retryDelayMs` into the server schema.
   */
  private async restorePending(operation: OutboxOperationRecord): Promise<void> {
    const attemptCount = operation.attemptCount + 1;
    const delayMs = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** operation.attemptCount);
    await this.deps.store.update({
      ...operation,
      dispatchState: 'PENDING',
      attemptCount,
      nextAttemptAt: this.now() + delayMs,
    });
  }

  private markTerminal(failure: DispatchFailure, summary: DrainSummary): void {
    if (failure === 'AUTH_REQUIRED') summary.authRequired += 1;
    else if (failure === 'ACCESS_DENIED') summary.accessDenied += 1;
    else if (failure === 'CONFLICT') summary.conflict += 1;
    else if (failure === 'INCOMPATIBLE_VERSION') summary.incompatibleVersion += 1;
  }

  private buildInput(operation: OutboxOperationRecord): Readonly<Record<string, unknown>> {
    // The payload is passed through EXACTLY as stored. Scheduling metadata
    // (`attemptCount`/`nextAttemptAt`) lives on the record, not in the payload,
    // so it can never be dispatched to the server.
    return {
      ...operation.payload,
      operationId: operation.operationId,
      bookId: operation.bookId,
      contentVersion: operation.contentVersion,
      kind: operation.kind,
      baseRevision: operation.baseRevision,
      payload: operation.payload,
    };
  }

  private ownerChanged(owner: AccountOwner): boolean {
    const current = this.deps.lifecycle.getOwner();
    return !current || current.subject !== owner.subject || current.epoch !== owner.epoch;
  }

  private blocked(reason: 'NO_OWNER' | 'LEASE_HELD', summary: DrainSummary): DrainResult {
    this.emitStatus('BLOCKED', [], summary, null);
    return { summary, blockedReason: reason };
  }

  private emitStatus(
    state: CoordinatorStatus['state'],
    operations: readonly OutboxOperationRecord[],
    summary: DrainSummary,
    lastError: string | null,
  ): void {
    const status: CoordinatorStatus = {
      state,
      pending: operations.filter((operation) => operation.dispatchState === 'PENDING').length,
      // Conflicts and terminal outcomes are counted from the DURABLE queue and
      // kept disjoint: a terminal access-denied/incompatible op is never counted
      // as a conflict.
      conflicts: operations.filter((operation) => operation.dispatchState === 'FAILED').length,
      terminal: operations.filter((operation) => operation.dispatchState === 'TERMINAL').length,
      // Broken out from `terminal` so incompatible-version recovery is surfaced
      // distinctly from access denial.
      incompatibleVersion: incompatibleVersionOperations(operations).length,
      accessDenied: accessDeniedOperations(operations).length,
      authRequired: summary.authRequired > 0,
      storageFailure: summary.storageFailure > 0,
      lastError,
    };
    this.lastStatus = status;
    this.deps.onStatus?.(status);
    for (const listener of this.listeners) listener(status);
  }

  /**
   * Fetches and merges the authoritative snapshot for every book with pending
   * work, then (when a store is wired) APPLIES the merged tombstones, conflict
   * copies and server-authoritative annotations so deletions and conflicts are
   * durable and surfaceable. `mergeSnapshot` guarantees pending operations are
   * never rebased and their payload/base revision is preserved. Returns what was
   * fetched/merged so callers can surface conflicts.
   */
  async refreshSnapshots(
    localAnnotations: readonly MergeAnnotation[] = [],
  ): Promise<SnapshotRefreshResult> {
    const empty: SnapshotRefreshResult = { books: 0, annotations: 0, tombstones: 0, conflicts: 0 };
    const owner = this.deps.lifecycle.getOwner();
    if (!owner) return empty;
    const operations = await this.deps.store.list(owner.subject);
    const books = [...new Set(operations.map((operation) => operation.bookId))];
    const report = { ...empty };

    for (const bookId of books) {
      const snapshot = await this.deps.snapshot(bookId);
      const bookPending = operations
        .filter((operation) => operation.bookId === bookId)
        .map((operation) => ({
          operationId: operation.operationId,
          kind: operation.kind,
          baseRevision: operation.baseRevision,
          payload: operation.payload,
        }));

      const result = mergeSnapshot({
        snapshot,
        local: localAnnotations,
        pending: pendingFromOperations(bookPending),
      });

      if (this.deps.snapshotStore) {
        await this.deps.snapshotStore.applyMerge(owner, { ...result, bookId });
      }

      report.books += 1;
      report.annotations += result.annotations.length;
      report.tombstones += result.tombstones.length;
      report.conflicts += result.conflictCopies.length;
    }

    return report;
  }

  /**
   * Controlled drain contract for sign-out/account-switch (Task 13B). Counts
   * every category of outstanding work. `fullyDrained` is false unless ALL are
   * zero, so pending, in-flight/uncertain, blocked-successor, or conflict work
   * can never be silently counted as drained.
   */
  async controlledDrain(): Promise<ControlledDrainReport> {
    const owner = this.deps.lifecycle.getOwner();
    if (!owner) {
      return { pending: 0, inFlightOrUncertain: 0, blockedSuccessors: 0, conflicts: 0, terminal: 0, fullyDrained: false };
    }
    const operations = await this.deps.store.list(owner.subject);
    const present = new Set(operations.map((operation) => operation.id));
    const blocked = operations.filter((operation) => isBlockedSuccessor(operation, present)).length;
    const inFlight = operations.filter((operation) => operation.dispatchState === 'DISPATCHING').length;
    // Conflicts and terminal outcomes are DISJOINT states, so an access-denied /
    // incompatible-version op never inflates the conflict figure.
    const conflicts = operations.filter((operation) => operation.dispatchState === 'FAILED').length;
    const terminal = operations.filter((operation) => operation.dispatchState === 'TERMINAL').length;
    // Pending excludes blocked successors (counted separately) so the categories
    // are disjoint and a blocked successor is never double-counted as pending.
    const pending = operations.filter(
      (operation) => operation.dispatchState === 'PENDING' && !isBlockedSuccessor(operation, present),
    ).length;
    const fullyDrained = operations.length === 0;
    return { pending, inFlightOrUncertain: inFlight, blockedSuccessors: blocked, conflicts, terminal, fullyDrained };
  }
}
