import {
  qualifyKey,
  type AccountOwner,
  type ConflictCopyRecord,
  type ConflictReason,
  type OutboxReceiptRecord,
} from './contracts';
import { OfflineDatabase } from './database';
import { accountLifecycle } from './account-activation';
import {
  nextLocalSequence,
  type OutboxOperationKind,
  type OutboxOperationRecord,
} from './outbox';

/**
 * Explicit conflict resolution (Task 12).
 *
 * A conflict is a durable outbox operation in the `FAILED` state (Task 11):
 * the server refused a stale local edit and preserved the offline edit as a
 * linked conflict copy. This module records the user's EXPLICIT decision —
 * accept the server record, keep the offline edit as its conflict copy, or
 * retarget a later edit onto the conflict copy's acknowledged id/revision — and
 * for PROGRESS explicitly choose the local or server resume position.
 *
 * It never rewrites the conflicted in-flight operation. Resolution that writes
 * server state appends a NEW replay-safe operation with a fresh operation id,
 * preserving the original pending operation's content version and payload
 * provenance.
 */

/** A persisted conflict copy; `serverId` retains the stable server identity. */
export interface StoredConflictCopyRecord extends ConflictCopyRecord {
  readonly serverId: string;
  /** Set once the user resolves the owning conflict; null while unresolved. */
  readonly resolution?: ConflictResolutionKind | null;
  readonly resolvedAt?: number | null;
}

export type ConflictResolutionKind = 'SERVER' | 'OFFLINE_COPY' | 'RETARGET';
export type ProgressChoice = 'LOCAL' | 'SERVER';
export type ConflictChoice = ConflictResolutionKind | ProgressChoice;

export type ConflictKind = 'ANNOTATION' | 'BOOKMARK' | 'PROGRESS';

/** The authoritative server record (or progress) for a conflicted entity. */
export interface ConflictServerValue {
  readonly revision: number | null;
  readonly value: unknown;
}

/** A `ConflictCopyRecord` reduced to the identity/provenance a panel needs. */
export interface ConflictCopyView {
  readonly serverId: string;
  readonly revision: number;
  readonly reason: ConflictReason;
  readonly sourceEntityId: string;
  readonly contentVersion: number;
  readonly page: number;
  readonly text: string | null;
  readonly note: string | null;
  readonly color: string | null;
  readonly anchor: unknown;
}

/**
 * The full picture of one unresolved conflict: the OUTBOX operation (the
 * offline edit), the SERVER record, and the linked CONFLICT COPY. All three
 * identities and payloads remain available so no version is silently lost.
 */
export interface ConflictView {
  readonly operationId: string;
  readonly outboxId: string;
  readonly kind: OutboxOperationKind;
  readonly conflictKind: ConflictKind;
  readonly bookId: string;
  /** Original pending content version (never remapped by resolution). */
  readonly contentVersion: number;
  readonly baseRevision: number | null;
  readonly entityKey: string;
  readonly sourceEntityId: string | null;
  readonly serverRevision: number | null;
  readonly serverValue: unknown | null;
  readonly offlineEdit: Readonly<Record<string, unknown>>;
  readonly conflictCopy: ConflictCopyView | null;
  readonly reason: ConflictReason | null;
  readonly successorOperationIds: readonly string[];
}

/** A planned, durable outbox mutation. New ops are appended, never rewritten. */
export interface ResolutionPlan {
  readonly removeIds: readonly string[];
  /** Full records to upsert (new operations and/or rebased successors). */
  readonly upserts: readonly OutboxOperationRecord[];
  /** New operation ids (for the result), in creation order. */
  readonly enqueuedOperationIds: readonly string[];
}

export interface ConflictResolutionResult {
  readonly status: 'RESOLVED' | 'FAILED';
  readonly choice: ConflictChoice | null;
  readonly enqueuedOperationIds: readonly string[];
  readonly error: string | null;
}

export interface ConflictResolverDeps {
  readonly database: OfflineDatabase;
  readonly getOwner: () => AccountOwner | null;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export interface ConflictPlanContext {
  readonly subject: string;
  readonly now: number;
  readonly newId: () => string;
}

// ── Views ──────────────────────────────────────────────────────────────────

function conflictKindOf(kind: OutboxOperationKind): ConflictKind {
  if (kind === 'PROGRESS_SET') return 'PROGRESS';
  if (kind === 'BOOKMARK_ADD' || kind === 'BOOKMARK_REMOVE') return 'BOOKMARK';
  return 'ANNOTATION';
}

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function toCopyView(record: StoredConflictCopyRecord | undefined): ConflictCopyView | null {
  if (!record) return null;
  return {
    serverId: record.serverId,
    revision: record.revision,
    reason: record.reason,
    sourceEntityId: record.sourceEntityId,
    contentVersion: record.contentVersion,
    page: record.page,
    text: record.text,
    note: record.note,
    color: record.color,
    anchor: record.anchor,
  };
}

/** True for a durable conflict (the Task 11 `FAILED` state, not `TERMINAL`). */
export function isConflictedOperation(operation: OutboxOperationRecord): boolean {
  return operation.dispatchState === 'FAILED';
}

/** Direct successors that depend on `outboxId` and must stay paused until resolved. */
export function directSuccessors(
  operations: readonly OutboxOperationRecord[],
  outboxId: string,
): OutboxOperationRecord[] {
  return operations.filter((operation) => operation.dependsOn === outboxId);
}

/**
 * Builds one conflict view from durable state. `serverValues` is keyed by the
 * conflicted operationId; when absent the server revision falls back to the
 * durable conflict receipt so a resolution can still be rebased safely.
 */
export function buildConflictView(
  operation: OutboxOperationRecord,
  operations: readonly OutboxOperationRecord[],
  copies: readonly StoredConflictCopyRecord[],
  receipts: readonly OutboxReceiptRecord[],
  serverValues: Readonly<Record<string, ConflictServerValue>> = {},
): ConflictView {
  const copy = copies.find((candidate) => candidate.operationId === operation.operationId);
  const receipt = receipts.find(
    (candidate) => candidate.operationId === operation.operationId && candidate.resultKind === 'CONFLICT',
  );
  const sourceEntityId =
    copy?.sourceEntityId ?? readString(operation.payload, 'entityId') ?? null;
  const server =
    serverValues[operation.operationId] ??
    (sourceEntityId ? serverValues[sourceEntityId] : undefined) ??
    null;

  return {
    operationId: operation.operationId,
    outboxId: operation.id,
    kind: operation.kind,
    conflictKind: conflictKindOf(operation.kind),
    bookId: operation.bookId,
    contentVersion: operation.contentVersion,
    baseRevision: operation.baseRevision,
    entityKey: operation.entityKey,
    sourceEntityId,
    serverRevision: server?.revision ?? receipt?.revision ?? null,
    serverValue: server?.value ?? null,
    offlineEdit: operation.payload,
    conflictCopy: toCopyView(copy),
    reason: copy?.reason ?? null,
    successorOperationIds: directSuccessors(operations, operation.id).map((o) => o.operationId),
  };
}

/** Every unresolved conflict for one book, stable-ordered by operation id. */
export function listConflictViews(
  operations: readonly OutboxOperationRecord[],
  copies: readonly StoredConflictCopyRecord[],
  receipts: readonly OutboxReceiptRecord[],
  serverValues: Readonly<Record<string, ConflictServerValue>> = {},
): ConflictView[] {
  return operations
    .filter(isConflictedOperation)
    .map((operation) => buildConflictView(operation, operations, copies, receipts, serverValues))
    .sort((a, b) => a.operationId.localeCompare(b.operationId));
}

// ── Plans ──────────────────────────────────────────────────────────────────

function namespacedId(context: ConflictPlanContext, operationId: string): string {
  return qualifyKey(context.subject, 'outbox', operationId);
}

/** The value a later edit contributes on top of the conflict copy's content. */
const RETARGET_PAYLOAD_KEYS = ['page', 'text', 'note', 'color', 'anchor'] as const;

function retargetOperation(
  successor: OutboxOperationRecord,
  copy: ConflictCopyView,
  context: ConflictPlanContext,
): OutboxOperationRecord {
  const operationId = context.newId();
  const overrides: Record<string, unknown> = {};
  for (const key of RETARGET_PAYLOAD_KEYS) {
    if (key in successor.payload) overrides[key] = successor.payload[key];
  }
  return {
    ...successor,
    id: namespacedId(context, operationId),
    operationId,
    kind: 'ANNOTATION_UPDATE',
    baseRevision: copy.revision,
    // Preserve the successor's local sequence and dependency so ordering and
    // provenance are unchanged; descendants are rewired onto the new op.
    seq: successor.seq,
    payload: {
      entityId: copy.serverId,
      targetKind: 'CONFLICT_COPY',
      baseRevision: copy.revision,
      page: copy.page,
      text: copy.text ?? '',
      note: copy.note,
      color: copy.color,
      anchor: copy.anchor,
      ...overrides,
    },
    dispatchState: 'PENDING',
    attemptCount: 0,
    createdAt: context.now,
  };
}

function rebindDescendants(
  operations: readonly OutboxOperationRecord[],
  fromOutboxId: string,
  toOutboxId: string,
): OutboxOperationRecord[] {
  return operations
    .filter((operation) => operation.dependsOn === fromOutboxId)
    .map((operation) => ({ ...operation, dependsOn: toOutboxId }));
}

/**
 * Accept the server record: drop the conflicted offline edit and rebase its
 * direct successors onto the acknowledged server revision (payload/provenance
 * preserved; the user explicitly reconciled, so no silent rebase).
 */
export function planServerChoice(
  conflict: ConflictView,
  operations: readonly OutboxOperationRecord[],
  serverRevision: number | null,
): ResolutionPlan {
  const rebased = serverRevision === null
    ? []
    : directSuccessors(operations, conflict.outboxId).map((successor) => ({
        ...successor,
        baseRevision: serverRevision,
      }));
  return { removeIds: [conflict.outboxId], upserts: rebased, enqueuedOperationIds: [] };
}

/**
 * Retarget the named successors onto the conflict copy's acknowledged
 * id/revision as NEW replay-safe operations. Only the intended successors (and
 * their descendants) are touched; the conflicted operation is removed, never
 * rewritten.
 */
export function planRetarget(
  conflict: ConflictView,
  operations: readonly OutboxOperationRecord[],
  copy: ConflictCopyView,
  successorOperationIds: readonly string[],
  context: ConflictPlanContext,
): ResolutionPlan {
  const intended = new Set(successorOperationIds);
  const successors = directSuccessors(operations, conflict.outboxId).filter((successor) =>
    intended.has(successor.operationId),
  );
  const upserts: OutboxOperationRecord[] = [];
  const enqueued: string[] = [];
  for (const successor of successors) {
    const retargeted = retargetOperation(successor, copy, context);
    upserts.push(retargeted, ...rebindDescendants(operations, successor.id, retargeted.id));
    enqueued.push(retargeted.operationId);
  }
  // Remove the conflicted op AND each replaced successor (its position is taken
  // by the fresh retargeted operation); descendants were rebound above.
  const removeIds = [conflict.outboxId, ...successors.map((successor) => successor.id)];
  return { removeIds, upserts, enqueuedOperationIds: enqueued };
}

/**
 * Keep the offline edit as its linked conflict copy: retarget every direct
 * successor onto the copy so the preserved chain never replays against stale
 * server state.
 */
export function planOfflineCopyChoice(
  conflict: ConflictView,
  operations: readonly OutboxOperationRecord[],
  copy: ConflictCopyView,
  context: ConflictPlanContext,
): ResolutionPlan {
  const successors = directSuccessors(operations, conflict.outboxId).map((o) => o.operationId);
  return planRetarget(conflict, operations, copy, successors, context);
}

/**
 * Resolve a PROGRESS conflict by explicit choice. `LOCAL` appends a new
 * replay-safe PROGRESS_SET carrying the local page (never a "highest page
 * wins"); `SERVER` drops the local edit and lets the caller adopt the server
 * position. The original pending content version is preserved.
 */
export function planProgressChoice(
  conflict: ConflictView,
  operations: readonly OutboxOperationRecord[],
  choice: ProgressChoice,
  serverRevision: number | null,
  context: ConflictPlanContext,
): ResolutionPlan {
  if (choice === 'SERVER') {
    return { removeIds: [conflict.outboxId], upserts: [], enqueuedOperationIds: [] };
  }
  const operationId = context.newId();
  const currentPage = conflict.offlineEdit.currentPage;
  const scrollY = conflict.offlineEdit.scrollY ?? null;
  const operation: OutboxOperationRecord = {
    id: namespacedId(context, operationId),
    subject: context.subject,
    epoch: epochOf(conflict, operations),
    operationId,
    entityKey: conflict.entityKey,
    bookId: conflict.bookId,
    contentVersion: conflict.contentVersion,
    kind: 'PROGRESS_SET',
    seq: nextLocalSequence(operations),
    dependsOn: null,
    baseRevision: serverRevision ?? 0,
    dispatchState: 'PENDING',
    attemptCount: 0,
    payload: { currentPage, scrollY },
    createdAt: context.now,
  };
  return { removeIds: [conflict.outboxId], upserts: [operation], enqueuedOperationIds: [operationId] };
}

function epochOf(conflict: ConflictView, operations: readonly OutboxOperationRecord[]): number {
  return operations.find((operation) => operation.operationId === conflict.operationId)?.epoch ?? 0;
}

// ── Content-version provenance ──────────────────────────────────────────────

export type AnnotationProvenance = 'PINNED' | 'UNRESOLVED_CONTENT_VERSION';

/**
 * An annotation is PINNED while its content version is still available. When
 * the referenced version is gone it is UNRESOLVED — its anchor must NOT be
 * reinterpreted against newer page content.
 */
export function annotationProvenance(
  annotation: { readonly contentVersion: number },
  availableContentVersions: readonly number[],
): AnnotationProvenance {
  return availableContentVersions.includes(annotation.contentVersion)
    ? 'PINNED'
    : 'UNRESOLVED_CONTENT_VERSION';
}

/** Versions still referenced by saved records or pending operations. */
export function referencedContentVersions(
  records: ReadonlyArray<{ readonly contentVersion?: number }>,
  operations: ReadonlyArray<{ readonly contentVersion?: number }>,
): number[] {
  const versions = new Set<number>();
  for (const entry of [...records, ...operations]) {
    if (Number.isSafeInteger(entry.contentVersion) && (entry.contentVersion ?? 0) >= 1) {
      versions.add(entry.contentVersion as number);
    }
  }
  return [...versions].sort((a, b) => a - b);
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Durable, explicit conflict resolution over the Task 4 store. Reads the
 * conflicted outbox operations, their linked conflict copies and receipts;
 * writes the chosen resolution as new operations / rebased successors and
 * marks the conflict copy resolved.
 */
export class ConflictResolver {
  private readonly database: OfflineDatabase;
  private readonly getOwner: () => AccountOwner | null;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(deps: ConflictResolverDeps) {
    this.database = deps.database;
    this.getOwner = deps.getOwner;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  }

  async listConflicts(
    bookId: string,
    serverValues: Readonly<Record<string, ConflictServerValue>> = {},
  ): Promise<ConflictView[]> {
    const owner = this.getOwner();
    if (!owner) return [];
    const [operations, copies, receipts] = await Promise.all([
      this.readOperations(owner.subject),
      this.readCopies(owner.subject),
      this.readReceipts(owner.subject),
    ]);
    return listConflictViews(operations, copies, receipts, serverValues).filter(
      (conflict) => conflict.bookId === bookId,
    );
  }

  /** Explicitly accept the server record for a conflicted entity. */
  async chooseServer(conflict: ConflictView): Promise<ConflictResolutionResult> {
    return this.resolve(conflict, 'SERVER');
  }

  /** Explicitly keep the offline edit as its linked conflict copy. */
  async keepOfflineCopy(conflict: ConflictView): Promise<ConflictResolutionResult> {
    return this.resolve(conflict, 'OFFLINE_COPY');
  }

  /** Explicitly retarget the named later edits onto the conflict copy. */
  async retarget(
    conflict: ConflictView,
    successorOperationIds: readonly string[],
  ): Promise<ConflictResolutionResult> {
    return this.resolve(conflict, 'RETARGET', successorOperationIds);
  }

  /** Explicitly resolve a PROGRESS conflict to the local or server position. */
  async resolveProgress(conflict: ConflictView, choice: ProgressChoice): Promise<ConflictResolutionResult> {
    return this.resolve(conflict, choice);
  }

  private async resolve(
    conflict: ConflictView,
    choice: ConflictChoice,
    successorOperationIds: readonly string[] = [],
  ): Promise<ConflictResolutionResult> {
    try {
      const owner = this.getOwner();
      if (!owner) return this.failure('No established account owns this device');
      const operations = await this.readOperations(owner.subject);
      const current = operations.find((operation) => operation.operationId === conflict.operationId);
      if (!current) return this.failure('This conflict is already resolved on this device');

      const plan = this.plan(owner.subject, conflict, operations, choice, successorOperationIds);
      if (!plan) return this.failure('This conflict can no longer be resolved as requested');

      for (const id of plan.removeIds) {
        await this.database.delete('outbox', id);
      }
      for (const operation of plan.upserts) {
        await this.database.putAccountRecord(owner.subject, owner.epoch, 'outbox', operation);
      }
      await this.markCopyResolved(owner, conflict, choice);
      return {
        status: 'RESOLVED',
        choice,
        enqueuedOperationIds: plan.enqueuedOperationIds,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not resolve on this device';
      return this.failure(message);
    }
  }

  private plan(
    subject: string,
    conflict: ConflictView,
    operations: readonly OutboxOperationRecord[],
    choice: ConflictChoice,
    successorOperationIds: readonly string[],
  ): ResolutionPlan | null {
    const context: ConflictPlanContext = { subject, now: this.now(), newId: this.newId };
    if (conflict.conflictKind === 'PROGRESS') {
      if (choice !== 'LOCAL' && choice !== 'SERVER') return null;
      return planProgressChoice(conflict, operations, choice, conflict.serverRevision, context);
    }
    if (choice === 'SERVER') {
      return planServerChoice(conflict, operations, conflict.serverRevision);
    }
    if (!conflict.conflictCopy) return null;
    if (choice === 'OFFLINE_COPY') {
      return planOfflineCopyChoice(conflict, operations, conflict.conflictCopy, context);
    }
    if (choice === 'RETARGET') {
      return planRetarget(conflict, operations, conflict.conflictCopy, successorOperationIds, context);
    }
    return null;
  }

  private async markCopyResolved(
    owner: AccountOwner,
    conflict: ConflictView,
    choice: ConflictChoice,
  ): Promise<void> {
    if (!conflict.conflictCopy) return;
    const copies = await this.readCopies(owner.subject);
    const copy = copies.find((candidate) => candidate.operationId === conflict.operationId);
    if (!copy) return;
    const resolution =
      choice === 'LOCAL' || choice === 'OFFLINE_COPY' ? 'OFFLINE_COPY' : (choice as ConflictResolutionKind);
    await this.database.putAccountRecord(owner.subject, owner.epoch, 'conflicts', {
      ...copy,
      resolution,
      resolvedAt: this.now(),
    });
  }

  private readOperations(subject: string): Promise<OutboxOperationRecord[]> {
    return this.database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', subject);
  }

  private readCopies(subject: string): Promise<StoredConflictCopyRecord[]> {
    return this.database.getAllByIndex<StoredConflictCopyRecord>('conflicts', 'subject', subject);
  }

  private readReceipts(subject: string): Promise<OutboxReceiptRecord[]> {
    return this.database.getAllByIndex<OutboxReceiptRecord>('receipts', 'subject', subject);
  }

  private failure(error: string): ConflictResolutionResult {
    return { status: 'FAILED', choice: null, enqueuedOperationIds: [], error };
  }
}

let shared: ConflictResolver | null = null;

/** Shared conflict resolver backed by Task 4 IndexedDB and Task 13A identity. */
export function conflictResolver(): ConflictResolver {
  shared ??= new ConflictResolver({
    database: new OfflineDatabase(),
    getOwner: () => accountLifecycle().getOwner(),
  });
  return shared;
}

/** Test seam: reset the lazy singleton without touching persisted records. */
export function resetConflictResolverForTests(): void {
  shared = null;
}
