import { AuthHttpError } from '../auth';
import {
  OfflineStorageError,
  receiptKey,
  type AccountOwner,
  type ConflictCopyRecord,
  type LeaseRecord,
  type OutboxReceiptRecord,
  type ReplayIdentity,
} from './contracts';
import type { OutboxOperationRecord, OutboxTerminalReason } from './outbox';
import {
  accessDeniedOperations,
  advanceSuccessorRevision,
  incompatibleVersionOperations,
  isBlockedSuccessor,
  isReadyForDispatch,
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
      /**
       * The full server conflict copy, when returned. Persisted immediately on
       * conflict so "keep my edit" works before any snapshot refresh.
       */
      readonly conflictCopy?: PersistedConflictCopy | null;
    }
  | { readonly kind: 'ACCESS_DENIED'; readonly resourceId: string; readonly reason: string }
  | {
      readonly kind: 'INCOMPATIBLE_VERSION';
      readonly requestedContentVersion: number;
      readonly supportedContentVersions: readonly number[];
    };

/** The server conflict copy in durable (epoch-ms) form. */
export interface PersistedConflictCopy {
  readonly id: string;
  readonly operationId: string;
  readonly sourceEntityId: string;
  readonly bookId: string;
  readonly contentVersion: number;
  readonly page: number;
  readonly text: string;
  readonly note: string | null;
  readonly color: string | null;
  readonly anchor: unknown;
  readonly revision: number;
  readonly reason: ConflictCopyRecord['reason'];
  readonly createdAt: number;
}

/**
 * Transport/server failure classification, kept distinct from operation
 * outcomes. The classes map to distinct UX: bounded retry (TRANSIENT),
 * reauthentication (AUTH_REQUIRED), permanent recovery/discard
 * (ACCESS_DENIED / INCOMPATIBLE_VERSION / REJECTED), user resolution (CONFLICT),
 * and a storage fault that must never be retried as a transport error
 * (STORAGE_FAILURE).
 */
export type DispatchFailure =
  | 'TRANSIENT'
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'CONFLICT'
  | 'INCOMPATIBLE_VERSION'
  | 'REJECTED'
  | 'STORAGE_FAILURE';

/** The reconciliation effect of one dispatched operation on the current run. */
interface DispatchEffect {
  readonly removed: boolean;
  readonly paused: boolean;
  readonly ackRevision: number | null;
  readonly blocked: boolean;
}

export interface OutboxStore {
  list(subject: string): Promise<OutboxOperationRecord[]>;
  remove(id: string): Promise<void>;
  update(record: OutboxOperationRecord): Promise<void>;
  /**
   * Marks the local record backing `entityKey` as durably acknowledged. Optional
   * seam so the coordinator can clear the record's "local-only" provenance after
   * an ack without importing the reader-records store.
   */
  markEntitySynced?(entityKey: string, subject: string, epoch: number): Promise<void>;
  /**
   * Atomically upserts rebased successors and removes discarded predecessors in
   * ONE transaction. Optional: without it, `discardConflicts` falls back to
   * sequential updates/removes (still leaving successors runnable, but not
   * crash-atomic). Production wires this to the IndexedDB resolver commit.
   */
  commitDiscard?(
    subject: string,
    epoch: number,
    upserts: readonly OutboxOperationRecord[],
    removeIds: readonly string[],
  ): Promise<void>;
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
    /**
     * Successor operations whose base revision must be rebased. When supplied,
     * the receipt, the operation removal, AND the successor updates commit in
     * ONE transaction, so a crash can never leave a removed predecessor beside a
     * successor still carrying a stale `baseRevision`.
     */
    successors?: readonly OutboxOperationRecord[],
  ): Promise<void>;
  recordRetained(subject: string, epoch: number, receipt: OutboxReceiptRecord): Promise<void>;
}

export type SnapshotSource = (bookId: string) => Promise<AuthoritativeSnapshot>;

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
  readonly lifecycle: {
    readonly getOwner: () => AccountOwner | null;
    /**
     * Whether replay may proceed for the established owner. Optional for
     * read-only/test contexts; when present, a non-READY result (e.g. a genuine
     * 401 parked as AUTH_REQUIRED) BLOCKS the drain instead of retrying forever.
     */
    readonly requireReplayIdentity?: () => ReplayIdentity;
  };
  readonly snapshot: SnapshotSource;
  readonly snapshotStore?: SnapshotApplyStore;
  /**
   * Reads the CURRENT local annotation set for a book (subject-scoped, including
   * soft-deleted rows). The merge needs the real local state so a server
   * tombstone removes a stale live row and a cross-device change is visible.
   * Optional; when absent `refreshSnapshots` passes an empty local set.
   */
  readonly readLocalAnnotations?: (
    subject: string,
    bookId: string,
  ) => Promise<readonly MergeAnnotation[]>;
  /**
   * Persists one conflict copy the coordinator received as a conflict outcome,
   * so "keep my edit" is available immediately rather than only after a later
   * snapshot refresh. Optional.
   */
  readonly persistConflictCopy?: (
    owner: AccountOwner,
    operation: OutboxOperationRecord,
    outcome: Extract<OperationOutcome, { kind: 'CONFLICT' }>,
  ) => Promise<void>;
  /**
   * Resolves the server-supported content version for an operation at DISPATCH
   * time. The online reader queues edits with a non-version-pinned sentinel that
   * `ReaderRecords` resolves to the locally pinned version or a fabricated `1`;
   * for a book never downloaded locally that `1` is rejected
   * `INCOMPATIBLE_VERSION`. A positive return value overrides the dispatched
   * envelope version WITHOUT mutating the durable operation, so pending
   * provenance is preserved. Optional; a `null`/invalid result keeps the
   * operation's stored version.
   */
  readonly resolveContentVersion?: (
    owner: AccountOwner,
    operation: OutboxOperationRecord,
  ) => Promise<number | null>;
  /**
   * Counts durable local reader records that are NOT backed by an outbox
   * operation (local-only work that would be lost on sign-out). Optional; when
   * absent, local-only work is treated as zero.
   */
  readonly countLocalOnly?: (subject: string) => Promise<number>;
  readonly lock?: CoordinationLock;
  readonly now?: () => number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Transient retry budget before an operation is retained TERMINAL. */
  readonly maxAttempts?: number;
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
  /** Transient retries that exhausted their bounded budget (now `TERMINAL`). */
  transientExhausted: number;
  /** Server contract rejections (HTTP 400) retained `TERMINAL`. */
  rejected: number;
  stale: number;
  storageFailure: number;
  authRequired: number;
}

export interface DrainResult {
  readonly summary: DrainSummary;
  readonly blockedReason: 'NO_OWNER' | 'LEASE_HELD' | 'AUTH_REQUIRED' | null;
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
  /**
   * Durable local records that would be lost and are NOT represented by an
   * outbox operation (e.g. a bare local-only write). Counted so an un-synced
   * sign-out is never called "fully drained" when only the outbox is empty.
   */
  readonly localOnly: number;
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
/**
 * Bounded transient retry budget. After this many failed attempts the operation
 * is retained `TERMINAL` (`RETRY_EXHAUSTED`) instead of retrying forever, so a
 * poison head cannot loop indefinitely. It stays user-recoverable / re-evaluable
 * rather than being silently discarded.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

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
 *
 * HTTP 400 is a server contract rejection (e.g. the server's
 * `validateOperation` / hash-mismatch `BadRequestException`): it is NOT
 * retryable, so it classifies as a terminal rejection rather than TRANSIENT.
 */
export function classifyDispatchError(error: unknown): DispatchFailure {
  if (error instanceof OfflineStorageError) return 'STORAGE_FAILURE';
  if (isStorageDomException(error)) return 'STORAGE_FAILURE';
  const status = statusOf(error);
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 400) return 'REJECTED';
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

/**
 * Transitive closure of operations to remove when discarding conflicted edits:
 * every conflicted root plus all (transitive) successors that depend on it.
 * Removing a conflicted predecessor without its successors would dispatch them
 * against a stale base revision, so they are discarded together.
 */
function collectDiscardClosure(
  roots: readonly OutboxOperationRecord[],
  all: readonly OutboxOperationRecord[],
): string[] {
  const remove = new Set(roots.map((operation) => operation.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of all) {
      if (remove.has(operation.id)) continue;
      if (operation.dependsOn !== null && remove.has(operation.dependsOn)) {
        remove.add(operation.id);
        changed = true;
      }
    }
  }
  return [...remove];
}

function emptySummary(): DrainSummary {
  return {
    applied: 0,
    conflict: 0,
    accessDenied: 0,
    incompatibleVersion: 0,
    transient: 0,
    transientExhausted: 0,
    rejected: 0,
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
  private readonly maxAttempts: number;
  private readonly leaseTtlMs: number;
  private readonly listeners = new Set<(status: CoordinatorStatus) => void>();
  private lastStatus: CoordinatorStatus | null = null;
  private inFlightDrain: Promise<DrainResult> | null = null;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
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
    if (conflicted.length === 0) return 0;

    // Discarding the conflicted edit MUST also discard every successor that
    // depended on it (transitively): leaving a successor behind would let it
    // dispatch against a stale `baseRevision` with no surviving predecessor. We
    // remove the whole dependent chain atomically rather than orphan it.
    const removeIds = collectDiscardClosure(conflicted, operations);
    const upserts: OutboxOperationRecord[] = [];
    if (this.deps.store.commitDiscard) {
      await this.deps.store.commitDiscard(owner.subject, owner.epoch, upserts, removeIds);
    } else {
      for (const id of removeIds) await this.deps.store.remove(id);
    }
    const remaining = operations.filter((operation) => !removeIds.includes(operation.id));
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

  /**
   * Pre-dispatch replay-identity gate. A genuine 401 parks replay as
   * AUTH_REQUIRED; replaying in that state would re-send every queued operation,
   * count each failure, and retry forever instead of pausing for same-subject
   * reauthentication. A verified identity that disagrees with the owner we are
   * about to dispatch for also fails closed. Returns the blocked result, or null
   * when replay may proceed. Extracted from `runDrain` to bound its cognitive
   * complexity.
   */
  private replayGate(initialOwner: AccountOwner, summary: DrainSummary): DrainResult | null {
    const replay = this.deps.lifecycle.requireReplayIdentity?.();
    if (!replay) return null;
    if (replay.status !== 'READY') {
      if (replay.reason === 'AUTH_REQUIRED') summary.authRequired += 1;
      return this.blocked('AUTH_REQUIRED', summary);
    }
    if (replay.owner.subject !== initialOwner.subject || replay.owner.epoch !== initialOwner.epoch) {
      return this.blocked('NO_OWNER', summary);
    }
    return null;
  }

  private async runDrain(): Promise<DrainResult> {
    const summary = emptySummary();
    const lifecycle = this.deps.lifecycle;
    const initialOwner = lifecycle.getOwner();
    if (!initialOwner) return this.blocked('NO_OWNER', summary);

    const gate = this.replayGate(initialOwner, summary);
    if (gate) return gate;

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
      const blockedRun = await this.processOperations(initialOwner, orderForDispatch(operations), summary, lease);
      // Re-read the DURABLE queue for the final status: dispatch updated each
      // operation's dispatchState (PENDING/FAILED/TERMINAL), so the in-memory
      // working copy is stale for conflict/terminal counts.
      const settled = await this.deps.store.list(initialOwner.subject);
      this.emitStatus(blockedRun ? 'BLOCKED' : 'IDLE', settled, summary, null);
      return { summary, blockedReason: blockedRun ? 'AUTH_REQUIRED' : null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      this.emitStatus('ERROR', [], summary, message);
      throw error;
    } finally {
      if (lock) await lock.release();
    }
  }

  /**
   * Dispatches the ordered queue. Returns true when the run was BLOCKED by a
   * genuine auth rejection (so the caller reports AUTH_REQUIRED rather than a
   * successful drain).
   */
  private async processOperations(
    owner: AccountOwner,
    ordered: readonly OutboxOperationRecord[],
    summary: DrainSummary,
    lease: LeaseRecord | null,
  ): Promise<boolean> {
    // Mutable working copy so a successor's advanced base revision is visible
    // when its turn comes, without mutating the persisted payload.
    const working = new Map(ordered.map((operation) => [operation.id, operation]));
    const pausedEntities = new Set<string>();

    for (const operation of ordered) {
      const current = working.get(operation.id);
      if (!current) continue;
      if (this.isSkippable(current, working, pausedEntities)) continue;
      if (this.ownerChanged(owner)) break;

      const effect = await this.dispatch(owner, current, summary, lease);
      this.applyEffect(operation, effect, working, pausedEntities);
      if (effect.blocked) {
        // A genuine auth rejection pauses the ENTIRE run: stop dispatching the
        // remaining queue so valid credentials are not hammered.
        return true;
      }
    }
    return false;
  }

  /**
   * True when an operation must not be dispatched on this pass: retained
   * `TERMINAL`, still inside its durable backoff window, paused behind an
   * earlier conflict on the same entity, or a blocked successor.
   */
  private isSkippable(
    operation: OutboxOperationRecord,
    working: ReadonlyMap<string, OutboxOperationRecord>,
    pausedEntities: ReadonlySet<string>,
  ): boolean {
    if (operation.dispatchState === 'TERMINAL') return true;
    if (!isReadyForDispatch(operation, this.now())) return true;
    if (pausedEntities.has(operation.entityKey)) return true;
    return isBlockedSuccessor(operation, new Set(working.keys()));
  }

  /** Applies one dispatch's reconciliation effect to the in-memory run state. */
  private applyEffect(
    operation: OutboxOperationRecord,
    effect: DispatchEffect,
    working: Map<string, OutboxOperationRecord>,
    pausedEntities: Set<string>,
  ): void {
    if (effect.removed) working.delete(operation.id);
    if (effect.paused) pausedEntities.add(operation.entityKey);
    if (effect.ackRevision !== null) {
      for (const [id, candidate] of working) {
        if (candidate.dependsOn === operation.id) {
          working.set(id, { ...candidate, baseRevision: effect.ackRevision });
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
  ): Promise<DispatchEffect> {
    await this.deps.store.update({ ...operation, dispatchState: 'DISPATCHING' });

    const input = await this.dispatchInput(owner, operation);

    let outcome: OperationOutcome;
    try {
      outcome = await this.deps.send(input);
    } catch (error) {
      return this.handleDispatchFailure(operation, error, summary);
    }

    // Discard stale results: the account changed or the sync lease is no longer
    // held by this coordinator while the request was in flight. The lease is
    // re-read and its fencing token verified — a local TTL guess is not proof.
    if (this.ownerChanged(owner) || (await this.leaseLost(lease))) {
      await this.restorePending(operation);
      summary.stale += 1;
      return { removed: false, paused: false, ackRevision: null, blocked: false };
    }

    const effect = await this.reconcile(owner, operation, outcome, summary);
    return { ...effect, blocked: false };
  }

  /**
   * Classifies a dispatch rejection and reconciles the durable operation state /
   * summary. A genuine 401 blocks the run without an attempt penalty; permanent
   * classifications are retained terminal; a transport 409 is a user-resolvable
   * conflict; everything else is a bounded transient retry. Extracted from
   * `dispatch` to bound its cognitive complexity.
   */
  private async handleDispatchFailure(
    operation: OutboxOperationRecord,
    error: unknown,
    summary: DrainSummary,
  ): Promise<DispatchEffect> {
    const failure = classifyDispatchError(error);
    if (failure === 'AUTH_REQUIRED') {
      await this.deps.store.update({ ...operation, dispatchState: 'PENDING' });
      summary.authRequired += 1;
      return { removed: false, paused: true, ackRevision: null, blocked: true };
    }
    if (failure === 'ACCESS_DENIED' || failure === 'INCOMPATIBLE_VERSION') {
      // Non-transient server classifications are TERMINAL, not retried forever.
      await this.retainTerminal(operation, failure);
      summary.accessDenied += failure === 'ACCESS_DENIED' ? 1 : 0;
      summary.incompatibleVersion += failure === 'INCOMPATIBLE_VERSION' ? 1 : 0;
      return { removed: false, paused: false, ackRevision: null, blocked: false };
    }
    if (failure === 'REJECTED') {
      // An HTTP 400 is a server contract rejection (e.g. hash-mismatch /
      // validateOperation). Retrying re-sends the same invalid input, so it is
      // retained TERMINAL rather than looping forever.
      await this.retainTerminal(operation, 'REJECTED');
      summary.rejected += 1;
      return { removed: false, paused: false, ackRevision: null, blocked: false };
    }
    if (failure === 'CONFLICT') {
      // A transport 409 with no parsed outcome is a durable conflict: mark it
      // FAILED (user-resolvable) instead of rescheduling it forever.
      await this.deps.store.update({
        ...operation,
        dispatchState: 'FAILED',
        attemptCount: operation.attemptCount + 1,
      });
      summary.conflict += 1;
      return { removed: false, paused: true, ackRevision: null, blocked: false };
    }
    // Truly transient network/5xx faults: reschedule WITH backoff within a
    // BOUNDED retry budget (exhausted attempts are retained TERMINAL).
    await this.rescheduleOrExhaust(operation, failure, summary);
    return { removed: false, paused: false, ackRevision: null, blocked: false };
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
    owner: AccountOwner,
    operation: OutboxOperationRecord,
    outcome: OperationOutcome,
    summary: DrainSummary,
  ): Promise<DispatchEffect> {
    switch (outcome.kind) {
      case 'APPLIED':
        await this.applyAck(operation, outcome);
        summary.applied += 1;
        return { removed: true, paused: false, ackRevision: outcome.revision, blocked: false };
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
        // Persist the returned conflict copy immediately so "keep my edit" is
        // usable before the next snapshot refresh.
        await this.deps.persistConflictCopy?.(owner, operation, outcome);
        await this.deps.store.update({ ...operation, dispatchState: 'FAILED', attemptCount: operation.attemptCount + 1 });
        summary.conflict += 1;
        return { removed: false, paused: true, ackRevision: null, blocked: false };
      case 'ACCESS_DENIED':
        await this.retainTerminal(operation, 'ACCESS_DENIED');
        summary.accessDenied += 1;
        return { removed: false, paused: false, ackRevision: null, blocked: false };
      case 'INCOMPATIBLE_VERSION':
        await this.retainTerminal(operation, 'INCOMPATIBLE_VERSION');
        summary.incompatibleVersion += 1;
        return { removed: false, paused: false, ackRevision: null, blocked: false };
      default:
        return { removed: false, paused: false, ackRevision: null, blocked: false };
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
    // Discover successors BEFORE the atomic commit so the receipt, the removal,
    // and the successor rebase all commit in ONE transaction. A crash can then
    // never leave a removed predecessor beside a stale-revision successor.
    const siblings = await this.deps.store.list(operation.subject);
    const successors = siblings
      .filter((sibling) => sibling.dependsOn === operation.id)
      .map((sibling) => advanceSuccessorRevision(sibling, outcome.revision));
    await this.deps.receipts.recordAndRemove(
      operation.id,
      operation.subject,
      operation.epoch,
      receipt,
      successors,
    );
    // Clear the local record's "local-only" provenance now that the server has
    // acknowledged it (best-effort).
    await this.deps.store.markEntitySynced?.(operation.entityKey, operation.subject, operation.epoch);
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
    terminalReason: OutboxTerminalReason,
  ): Promise<void> {
    await this.deps.store.update({
      ...operation,
      dispatchState: 'TERMINAL',
      terminalReason,
      attemptCount: operation.attemptCount + 1,
      // A terminal operation is not scheduled for another attempt; clear any
      // stale backoff window so a later explicit re-evaluation is not gated.
      nextAttemptAt: null,
    });
  }

  /**
   * Bounded retry policy for a transient/storage failure. Below the attempt
   * maximum the operation is rescheduled with durable backoff. At the maximum it
   * is retained `TERMINAL` (`RETRY_EXHAUSTED`): a poison head cannot be retried
   * forever, yet the immutable id/payload is preserved for explicit recovery.
   */
  private async rescheduleOrExhaust(
    operation: OutboxOperationRecord,
    failure: DispatchFailure,
    summary: DrainSummary,
  ): Promise<void> {
    if (operation.attemptCount + 1 >= this.maxAttempts) {
      await this.retainTerminal(operation, 'RETRY_EXHAUSTED');
      summary.transientExhausted += 1;
      return;
    }
    await this.restorePending(operation);
    if (failure === 'STORAGE_FAILURE') summary.storageFailure += 1;
    else summary.transient += 1;
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

  private async dispatchInput(
    owner: AccountOwner,
    operation: OutboxOperationRecord,
  ): Promise<Readonly<Record<string, unknown>>> {
    const input = this.buildInput(operation);
    // Resolve the CURRENT supported version at dispatch so an edit for a
    // non-downloaded book is not stamped a fabricated `1` and rejected
    // INCOMPATIBLE_VERSION. The durable operation is never mutated; only the
    // sent envelope is overridden.
    const resolver = this.deps.resolveContentVersion;
    const resolved = resolver ? await resolver(owner, operation) : null;
    return this.applyContentVersion(input, resolved);
  }

  /** Overrides the envelope content version only for a valid positive integer. */
  private applyContentVersion(
    input: Readonly<Record<string, unknown>>,
    resolved: number | null | undefined,
  ): Readonly<Record<string, unknown>> {
    if (typeof resolved === 'number' && Number.isSafeInteger(resolved) && resolved >= 1) {
      return { ...input, contentVersion: resolved };
    }
    return input;
  }

  private buildInput(operation: OutboxOperationRecord): Readonly<Record<string, unknown>> {
    // The payload is passed through EXACTLY as stored. Scheduling metadata
    // (`attemptCount`/`nextAttemptAt`) lives on the record, not in the payload,
    // so it can never be dispatched to the server. The nested `payload` object is
    // deliberately NOT included: `ReaderOperationInput` is a FLATTENED envelope
    // with no `payload` field, so dispatching only the per-kind fields plus the
    // envelope fields avoids relying on server-side ValidationPipe stripping.
    return {
      ...operation.payload,
      operationId: operation.operationId,
      bookId: operation.bookId,
      contentVersion: operation.contentVersion,
      kind: operation.kind,
      baseRevision: operation.baseRevision,
    };
  }

  private ownerChanged(owner: AccountOwner): boolean {
    const current = this.deps.lifecycle.getOwner();
    return current?.subject !== owner.subject || current.epoch !== owner.epoch;
  }

  private blocked(reason: 'NO_OWNER' | 'LEASE_HELD' | 'AUTH_REQUIRED', summary: DrainSummary): DrainResult {
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
  async refreshSnapshots(): Promise<SnapshotRefreshResult> {
    const empty: SnapshotRefreshResult = { books: 0, annotations: 0, tombstones: 0, conflicts: 0 };
    const owner = this.deps.lifecycle.getOwner();
    if (!owner) return empty;
    const operations = await this.deps.store.list(owner.subject);
    const books = [...new Set(operations.map((operation) => operation.bookId))];
    const report = { ...empty };

    for (const bookId of books) {
      // Re-read ownership INSIDE the loop: a cross-tab account switch during a
      // multi-book refresh must stop the run, not project one owner's snapshot
      // into another owner's records.
      if (this.ownerChanged(owner)) break;

      // Isolate per-book failures: a snapshot fetch/merge fault for one book
      // must not abort the refresh for other books, but a stale owner still
      // stops the run (checked above).
      try {
        const snapshot = await this.deps.snapshot(bookId);
        // Read the REAL local annotation set for this book so the merge can
        // apply server tombstones to stale live rows and surface cross-device
        // changes. Callers may still pass an explicit set for read-only
        // contexts.
        const local = this.deps.readLocalAnnotations
          ? await this.deps.readLocalAnnotations(owner.subject, bookId)
          : [];
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
          local,
          pending: pendingFromOperations(bookPending),
        });

        if (this.deps.snapshotStore) {
          await this.deps.snapshotStore.applyMerge(owner, { ...result, bookId });
        }

        report.books += 1;
        report.annotations += result.annotations.length;
        report.tombstones += result.tombstones.length;
        report.conflicts += result.conflictCopies.length;
      } catch {
        // A single book's failure is skipped; the remaining books still refresh.
      }
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
      return {
        pending: 0,
        inFlightOrUncertain: 0,
        blockedSuccessors: 0,
        conflicts: 0,
        terminal: 0,
        localOnly: 0,
        fullyDrained: false,
      };
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
    // Local-only durable records are work the outbox does not represent; they
    // must block "fully drained" too, or an un-synced sign-out loses them.
    const localOnly = this.deps.countLocalOnly ? await this.deps.countLocalOnly(owner.subject) : 0;
    const fullyDrained = operations.length === 0 && localOnly === 0;
    return {
      pending,
      inFlightOrUncertain: inFlight,
      blockedSuccessors: blocked,
      conflicts,
      terminal,
      localOnly,
      fullyDrained,
    };
  }
}
