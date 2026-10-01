import { AuthHttpError } from '../auth';
import type { AccountOwner } from './contracts';
import type { OutboxOperationRecord } from './outbox';
import { advanceSuccessorRevision, isBlockedSuccessor, orderForDispatch } from './outbox';
import {
  mergeSnapshot,
  type AuthoritativeSnapshot,
  type MergeAnnotation,
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
      readonly conflictCopyId?: string | null;
    }
  | { readonly kind: 'ACCESS_DENIED'; readonly resourceId: string; readonly reason: string }
  | {
      readonly kind: 'INCOMPATIBLE_VERSION';
      readonly requestedContentVersion: number;
      readonly supportedContentVersions: readonly number[];
    };

/** Transport failure classification, kept distinct from operation outcomes. */
export type DispatchFailure =
  | 'TRANSIENT'
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'CONFLICT'
  | 'INCOMPATIBLE_VERSION';

export interface OutboxStore {
  list(subject: string): Promise<OutboxOperationRecord[]>;
  remove(id: string): Promise<void>;
  update(record: OutboxOperationRecord): Promise<void>;
}

export interface ReceiptStore {
  record(receipt: {
    readonly operationId: string;
    readonly entityId: string | null;
    readonly revision: number | null;
    readonly resultKind: 'APPLIED' | 'CONFLICT' | 'INCOMPATIBLE_VERSION' | 'ACCESS_DENIED';
    readonly acknowledgedAt: number;
  }): Promise<void>;
  /**
   * Atomically records the receipt AND removes the acknowledged operation in
   * one storage transaction. When provided, the coordinator uses this instead
   * of `record` + `store.remove` so a crash cannot leave a receipt without
   * removing its operation (or vice versa). Subject/epoch come from the
   * operation, so the fenced write is always correctly scoped.
   */
  recordAndRemove?(
    outboxId: string,
    subject: string,
    epoch: number,
    receipt: {
      readonly operationId: string;
      readonly entityId: string | null;
      readonly revision: number | null;
      readonly resultKind: 'APPLIED' | 'CONFLICT' | 'INCOMPATIBLE_VERSION' | 'ACCESS_DENIED';
      readonly acknowledgedAt: number;
    },
  ): Promise<void>;
}

export interface SnapshotSource {
  (bookId: string): Promise<AuthoritativeSnapshot>;
}

export interface CoordinationLock {
  acquire(): Promise<{ readonly acquired: boolean; readonly ownerId: string }>;
  release(): Promise<void>;
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
}

export interface DrainResult {
  readonly summary: DrainSummary;
  readonly blockedReason: 'NO_OWNER' | 'LEASE_HELD' | null;
}

export interface ControlledDrainReport {
  readonly pending: number;
  readonly inFlightOrUncertain: number;
  readonly blockedSuccessors: number;
  readonly conflicts: number;
  readonly fullyDrained: boolean;
}

export interface CoordinatorStatus {
  readonly state: 'IDLE' | 'SYNCING' | 'BLOCKED' | 'ERROR';
  readonly pending: number;
  readonly conflicts: number;
  readonly lastError: string | null;
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
 * reauthentication, permanent recovery/discard, or bounded retry.
 */
export function classifyDispatchError(error: unknown): DispatchFailure {
  const status = statusOf(error);
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'ACCESS_DENIED';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'INCOMPATIBLE_VERSION';
  return 'TRANSIENT';
}

function emptySummary(): DrainSummary {
  return { applied: 0, conflict: 0, accessDenied: 0, incompatibleVersion: 0, transient: 0, stale: 0 };
}

/** Operation ids that some queued operation still depends on. */
function dependencyTargets(operations: readonly OutboxOperationRecord[]): Set<string> {
  const targets = new Set<string>();
  for (const operation of operations) {
    if (operation.dependsOn !== null) targets.add(operation.dependsOn);
  }
  return targets;
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
  private inFlightDrain: Promise<DrainResult> | null = null;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
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
    if (lock) {
      const acquired = await lock.acquire();
      if (!acquired.acquired) return this.blocked('LEASE_HELD', summary);
    }

    try {
      if (lifecycle.getOwner()?.subject !== initialOwner.subject) return this.blocked('NO_OWNER', summary);
      const operations = await this.deps.store.list(initialOwner.subject);
      await this.processOperations(initialOwner, orderForDispatch(operations), summary);
      this.emitStatus('IDLE', operations, null);
      return { summary, blockedReason: null };
    } catch (error) {
      this.emitStatus('ERROR', [], error instanceof Error ? error.message : 'Sync failed');
      throw error;
    } finally {
      if (lock) await lock.release();
    }
  }

  private async processOperations(
    owner: AccountOwner,
    ordered: readonly OutboxOperationRecord[],
    summary: DrainSummary,
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
      if (this.ownerChanged(owner)) return;

      const effect = await this.dispatch(owner, current, summary);
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
  ): Promise<{ removed: boolean; paused: boolean; ackRevision: number | null }> {
    const startedAt = this.now();
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
      else this.markTerminal(failure, summary);
      return { removed: false, paused: false, ackRevision: null };
    }

    // Discard stale results: the account changed or the sync lease expired while
    // the request was in flight. The operation stays replayable.
    if (this.ownerChanged(owner) || this.leaseExpired(startedAt)) {
      await this.restorePending(operation);
      summary.stale += 1;
      return { removed: false, paused: false, ackRevision: null };
    }

    return this.reconcile(operation, outcome, summary);
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
        await this.deps.receipts.record({
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
        await this.terminalOutcome(operation, 'ACCESS_DENIED', outcome.resourceId, null);
        summary.accessDenied += 1;
        return { removed: false, paused: false, ackRevision: null };
      case 'INCOMPATIBLE_VERSION':
        await this.terminalOutcome(operation, 'INCOMPATIBLE_VERSION', null, outcome.requestedContentVersion);
        summary.incompatibleVersion += 1;
        return { removed: false, paused: false, ackRevision: null };
      default:
        return { removed: false, paused: false, ackRevision: null };
    }
  }

  /**
   * Applies an acknowledgement ATOMICALLY from the coordinator's perspective:
   * the receipt is stored, successors on the SAME entity have their base
   * revision advanced to the ack revision (only after a successful ack on the
   * intended entity), and then only the acknowledged operation is removed.
   */
  private async applyAck(
    operation: OutboxOperationRecord,
    outcome: Extract<OperationOutcome, { kind: 'APPLIED' }>,
  ): Promise<void> {
    const receipt = {
      operationId: operation.operationId,
      entityId: outcome.entityId,
      revision: outcome.revision,
      resultKind: 'APPLIED' as const,
      acknowledgedAt: this.now(),
    };

    if (this.deps.receipts.recordAndRemove) {
      // Atomic: store the receipt and remove the acknowledged operation together.
      await this.deps.receipts.recordAndRemove(operation.id, operation.subject, operation.epoch, receipt);
    } else {
      await this.deps.receipts.record(receipt);
      await this.deps.store.remove(operation.id);
    }

    // Advance ONLY the successor's base revision; never its payload.
    const siblings = await this.deps.store.list(operation.subject);
    for (const sibling of siblings) {
      if (sibling.dependsOn !== operation.id) continue;
      await this.deps.store.update(advanceSuccessorRevision(sibling, outcome.revision));
    }
  }

  private async terminalOutcome(
    operation: OutboxOperationRecord,
    resultKind: 'INCOMPATIBLE_VERSION' | 'ACCESS_DENIED',
    entityId: string | null,
    revision: number | null,
  ): Promise<void> {
    // Terminal until user/account/content state changes: durable receipt +
    // retained queue entry (the contracts specify no short-lived receipt).
    await this.deps.receipts.record({
      operationId: operation.operationId,
      entityId,
      revision,
      resultKind,
      acknowledgedAt: this.now(),
    });
    await this.deps.store.update({ ...operation, dispatchState: 'FAILED', attemptCount: operation.attemptCount + 1 });
  }

  private async restorePending(operation: OutboxOperationRecord): Promise<void> {
    const attemptCount = operation.attemptCount + 1;
    const delayMs = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** operation.attemptCount);
    await this.deps.store.update({
      ...operation,
      dispatchState: 'PENDING',
      attemptCount,
      // Bounded backoff is advisory scheduling metadata for the next trigger;
      // the operation remains immediately replayable on an explicit retry.
      payload: { ...operation.payload, retryDelayMs: delayMs },
    });
  }

  private markTerminal(failure: DispatchFailure, summary: DrainSummary): void {
    if (failure === 'AUTH_REQUIRED') summary.stale += 1;
    else if (failure === 'ACCESS_DENIED') summary.accessDenied += 1;
    else if (failure === 'CONFLICT') summary.conflict += 1;
    else if (failure === 'INCOMPATIBLE_VERSION') summary.incompatibleVersion += 1;
  }

  private buildInput(operation: OutboxOperationRecord): Readonly<Record<string, unknown>> {
    return {
      ...operation.payload,
      operationId: operation.operationId,
      bookId: operation.bookId,
      contentVersion: operation.contentVersion,
      kind: operation.kind,
      baseRevision: operation.baseRevision,
      // The original payload is passed through unchanged so the transport layer
      // (and its tests) can prove it is never mutated across retries.
      payload: operation.payload,
    };
  }

  private ownerChanged(owner: AccountOwner): boolean {
    const current = this.deps.lifecycle.getOwner();
    return !current || current.subject !== owner.subject || current.epoch !== owner.epoch;
  }

  private leaseExpired(startedAt: number): boolean {
    return this.now() - startedAt > this.leaseTtlMs;
  }

  private blocked(reason: 'NO_OWNER' | 'LEASE_HELD', summary: DrainSummary): DrainResult {
    this.emitStatus('BLOCKED', [], null);
    return { summary, blockedReason: reason };
  }

  private emitStatus(state: CoordinatorStatus['state'], operations: readonly OutboxOperationRecord[], lastError: string | null): void {
    if (!this.deps.onStatus) return;
    this.deps.onStatus({
      state,
      pending: operations.filter((operation) => operation.dispatchState === 'PENDING').length,
      conflicts: operations.filter((operation) => operation.dispatchState === 'FAILED').length,
      lastError,
    });
  }

  /**
   * Fetches and merges the authoritative snapshot for every book with pending
   * work. `mergeSnapshot` guarantees pending operations are never rebased and
   * their payload/base revision is preserved.
   */
  async refreshSnapshots(
    localAnnotations: readonly MergeAnnotation[] = [],
  ): Promise<void> {
    const owner = this.deps.lifecycle.getOwner();
    if (!owner) return;
    const operations = await this.deps.store.list(owner.subject);
    const books = [...new Set(operations.map((operation) => operation.bookId))];
    for (const bookId of books) {
      const snapshot = await this.deps.snapshot(bookId);
      mergeSnapshot({
        snapshot,
        local: localAnnotations,
        pending: operations
          .filter((operation) => operation.bookId === bookId)
          .map((operation) => ({
            operationId: operation.operationId,
            kind: operation.kind,
            entityId: (operation.payload.entityId as string | undefined) ?? null,
            clientEntityId: (operation.payload.clientEntityId as string | undefined) ?? null,
            baseRevision: operation.baseRevision,
            payload: operation.payload,
          })),
      });
    }
  }

  /**
   * Controlled drain contract for sign-out/account-switch (Task 13B). Counts
   * every category of outstanding work. `fullyDrained` is false unless ALL are
   * zero, so pending, in-flight/uncertain, blocked-successor, or conflict work
   * can never be silently counted as drained.
   */
  async controlledDrain(): Promise<ControlledDrainReport> {
    const owner = this.deps.lifecycle.getOwner();
    if (!owner) return { pending: 0, inFlightOrUncertain: 0, blockedSuccessors: 0, conflicts: 0, fullyDrained: false };
    const operations = await this.deps.store.list(owner.subject);
    const present = new Set(operations.map((operation) => operation.id));
    const blocked = operations.filter((operation) => isBlockedSuccessor(operation, present)).length;
    const inFlight = operations.filter((operation) => operation.dispatchState === 'DISPATCHING').length;
    const conflicts = operations.filter((operation) => operation.dispatchState === 'FAILED').length;
    // Pending excludes blocked successors (counted separately) so the categories
    // are disjoint and a blocked successor is never double-counted as pending.
    const pending = operations.filter(
      (operation) => operation.dispatchState === 'PENDING' && !isBlockedSuccessor(operation, present),
    ).length;
    const fullyDrained = operations.length === 0;
    return { pending, inFlightOrUncertain: inFlight, blockedSuccessors: blocked, conflicts, fullyDrained };
  }
}

/** Pure helper for the UI: how many queued ops remain for one subject. */
export function countOutstanding(operations: readonly OutboxOperationRecord[]): number {
  return dependencyTargets(operations).size + operations.length;
}
