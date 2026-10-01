'use client';

import { OfflineDatabase, createIndexedDbLeasePersistence } from './database';
import { accountLifecycle } from './account-activation';
import { createSyncLock } from './coordination';
import { qualifyKey, type BookmarkRecord, type HighlightRecord, type TombstoneRecord } from './contracts';
import type { StoredConflictCopyRecord } from './conflicts';

export type { StoredConflictCopyRecord } from './conflicts';
import { dispatchReaderOperation } from '../reader/api';
import { fetchAnnotationSnapshot } from '../reader/api';
import {
  SyncCoordinator,
  type BookMergeResult,
  type OperationOutcome,
  type OutboxStore,
  type PersistedConflictCopy,
  type ReceiptStore,
  type SnapshotApplyStore,
  type SnapshotSource,
} from './sync-coordinator';
import type { OutboxOperationRecord } from './outbox';
import type { AuthoritativeSnapshot, MergeAnnotation } from './snapshot-merge';

/** A stable per-tab identity for the cross-tab sync lease. */
function tabId(): string {
  const globalWithTab = globalThis as { __transformlitTabId?: string };
  globalWithTab.__transformlitTabId ??= globalThis.crypto.randomUUID();
  return globalWithTab.__transformlitTabId;
}

/**
 * Maps the generated operation result to the coordinator's outcome. The server
 * response is the single source of truth for APPLIED/CONFLICT/…; a transport
 * error is thrown so the coordinator classifies it (never an acknowledgement).
 */
export function toOutcome(
  result: Awaited<ReturnType<typeof dispatchReaderOperation>>,
): OperationOutcome {
  const variant = result.result;
  switch (variant.__typename) {
    case 'ReaderOperationApplied':
      return { kind: 'APPLIED', entityId: variant.entityId, revision: variant.revision, receiptId: variant.receiptId };
    case 'ReaderOperationConflict': {
      const copy = variant.conflictCopy;
      return {
        kind: 'CONFLICT',
        entityId: variant.entityId,
        serverRevision: variant.serverRevision,
        serverValue: variant.serverValue,
        conflictCopyId: copy?.id ?? null,
        conflictCopy: copy ? toPersistedCopy(copy) : null,
      };
    }
    case 'ReaderOperationIncompatibleVersion':
      return {
        kind: 'INCOMPATIBLE_VERSION',
        requestedContentVersion: variant.requestedContentVersion,
        supportedContentVersions: variant.supportedContentVersions,
      };
    case 'ReaderOperationAccessDenied':
      return { kind: 'ACCESS_DENIED', resourceId: variant.resourceId, reason: variant.reason };
    default:
      throw new Error('Unknown reader operation result');
  }
}

/** Converts a wire conflict copy (ISO timestamps) into durable epoch-ms form. */
function toPersistedCopy(
  copy: NonNullable<
    Extract<Awaited<ReturnType<typeof dispatchReaderOperation>>['result'], { __typename: 'ReaderOperationConflict' }>['conflictCopy']
  >,
): PersistedConflictCopy {
  return {
    id: copy.id,
    operationId: copy.operationId,
    sourceEntityId: copy.sourceEntityId,
    bookId: copy.bookId,
    contentVersion: copy.contentVersion,
    page: copy.page,
    text: copy.text,
    note: copy.note,
    color: copy.color,
    // The operation-result selection omits `anchor` (nullable per contract); a
    // later snapshot refresh supplies the authoritative anchor.
    anchor: null,
    revision: copy.revision,
    reason: copy.reason,
    createdAt: Date.parse(String(copy.createdAt)),
  };
}

/** Builds the real outbox store over Task 4 IndexedDB (account-scoped). */
export function createOutboxStore(database: OfflineDatabase): OutboxStore {
  return {
    list: (subject) => database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', subject),
    remove: (id) => database.delete('outbox', id),
    update: (record) => database.putAccountRecord(record.subject, record.epoch, 'outbox', record),
    markEntitySynced: async (entityKey, subject, epoch) => {
      const record = await database.get<{ subject: string; syncedAt?: number | null }>(
        'readerRecords',
        entityKey,
      );
      if (!record || record.subject !== subject) return;
      await database.putAccountRecord(subject, epoch, 'readerRecords', {
        ...record,
        syncedAt: Date.now(),
      });
    },
  };
}

/**
 * Counts durable local reader records that are NOT acknowledged (local-only):
 * present, not deleted, and never marked synced. These are work the outbox does
 * not represent and would be lost on sign-out, so they gate `fullyDrained`.
 */
async function countLocalOnlyRecords(database: OfflineDatabase, subject: string): Promise<number> {
  const rows = await database.getAllByIndex<{ deletedAt?: number | null; syncedAt?: number | null }>(
    'readerRecords',
    'subject',
    subject,
  );
  return rows.filter((row) => row.deletedAt === null && (row.syncedAt ?? null) === null).length;
}

/**
 * Builds the real receipt store. `recordAndRemove` uses the Task 4
 * `acknowledgeOperation` primitive so the COMPLETE receipt (id + subject) and
 * the acknowledged operation's removal commit in ONE transaction.
 * `recordRetained` stores a durable CONFLICT receipt without removing the
 * operation (it must stay queued until resolved). There is no non-atomic
 * fallback.
 */
export function createReceiptStore(database: OfflineDatabase): ReceiptStore {
  return {
    recordAndRemove: (outboxId, subject, epoch, receipt) =>
      database.acknowledgeOperation(subject, epoch, outboxId, receipt),
    recordRetained: (subject, epoch, receipt) =>
      database.recordReceipt(subject, epoch, receipt),
  };
}

/**
 * Applies a merged snapshot to durable local state: server tombstones become
 * durable deletion history and conflict copies are persisted so conflicts are
 * surfaced (not silently dropped).
 *
 * The merged `annotations` are PROJECTED into the subject-scoped `readerRecords`
 * rows so cross-device changes become locally visible and a server tombstone can
 * remove a stale live row. Pending local work is preserved by the merge (which
 * returns it unchanged), and a record touched by pending work is never clobbered
 * here because the merge result already carries the pending value.
 */
export function createSnapshotStore(database: OfflineDatabase): SnapshotApplyStore {
  return {
    async applyMerge(owner, result: BookMergeResult): Promise<void> {
      for (const tombstone of result.tombstones) {
        const record: TombstoneRecord = {
          id: qualifyKey(owner.subject, 'tombstone', tombstone.entityId),
          subject: owner.subject,
          entityId: tombstone.entityId,
          kind: tombstone.kind,
          revision: tombstone.revision,
          deletedAt: tombstone.deletedAt,
        };
        await database.putAccountRecord(owner.subject, owner.epoch, 'tombstones', record);
      }

      await projectAnnotations(database, owner, result.bookId, result);

      for (const conflict of result.conflictCopies) {
        const key = qualifyKey(owner.subject, 'conflict', conflict.id);
        // Merge by stable server identity, PRESERVING any local resolution and
        // its timestamp. Without this, a refresh after resolve would overwrite
        // the resolution marker and the resolver's idempotence guard would fail,
        // appending a duplicate retargeted operation.
        const existing = await database.get<StoredConflictCopyRecord>('conflicts', key);
        const record: StoredConflictCopyRecord = {
          ...conflict,
          serverId: conflict.id,
          id: key,
          subject: owner.subject,
          ...(existing
            ? { resolution: existing.resolution ?? null, resolvedAt: existing.resolvedAt ?? null }
            : {}),
        };
        await database.putAccountRecord(owner.subject, owner.epoch, 'conflicts', record);
      }
    },
  };
}

/** The local `readerRecords` namespace ('bookmark' | 'highlight') for a kind. */
function recordNamespace(kind: 'BOOKMARK' | 'ANNOTATION'): 'bookmark' | 'highlight' {
  return kind === 'BOOKMARK' ? 'bookmark' : 'highlight';
}

/** Local record key derived from a merged annotation's stable identity. */
function annotationRecordKey(
  subject: string,
  annotation: MergeAnnotation,
): string {
  const id = annotation.clientEntityId ?? annotation.id;
  return qualifyKey(subject, recordNamespace(annotation.kind), id);
}

/** Reads `data.page` (a positive integer) or falls back to 1. */
function readPage(data: Readonly<Record<string, unknown>>): number {
  const value = data.page;
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

/**
 * Projects the merged annotation set into `readerRecords` for one book:
 * upserts present/soft-deleted merged rows and soft-deletes live local rows
 * whose entity is tombstoned and absent from the merge (i.e. no pending work).
 */
async function projectAnnotations(
  database: OfflineDatabase,
  owner: { subject: string; epoch: number },
  bookId: string,
  result: BookMergeResult,
): Promise<void> {
  const existing = await database.getAllByIndex<BookmarkRecord | HighlightRecord>(
    'readerRecords',
    'subjectBook',
    [owner.subject, bookId],
  );
  const presentKeys = new Set(result.annotations.map((annotation) => annotationRecordKey(owner.subject, annotation)));

  for (const annotation of result.annotations) {
    const key = annotationRecordKey(owner.subject, annotation);
    const prior = existing.find((row) => row.id === key);
    // A merged annotation that carries a distinct server id is
    // server-authoritative: record its `serverEntityId` so a later refresh keys
    // by the same stable identity. A local-only pending row has
    // `id === clientEntityId` and no server id yet.
    const serverEntityId =
      annotation.clientEntityId !== null && annotation.id === annotation.clientEntityId
        ? null
        : annotation.id;
    const base = {
      id: key,
      subject: owner.subject,
      clientEntityId: annotation.clientEntityId ?? annotation.id,
      serverEntityId,
      bookId,
      contentVersion: readContentVersion(annotation.data),
      revision: annotation.revision,
      deletedAt: annotation.deletedAt,
      ...(prior ? { syncedAt: prior.syncedAt ?? null } : {}),
    };
    if (annotation.kind === 'BOOKMARK') {
      const record: BookmarkRecord = {
        ...base,
        page: readPage(annotation.data),
        label: readNullableString(annotation.data.label),
        color: readNullableString(annotation.data.color),
        anchor: annotation.data.anchor ?? null,
        createdAt: readNumber(annotation.data.createdAt, prior?.createdAt ?? Date.now()),
        updatedAt: readNumber(annotation.data.updatedAt, prior?.updatedAt ?? Date.now()),
      };
      await database.putAccountRecord(owner.subject, owner.epoch, 'readerRecords', record);
      continue;
    }
    const highlight: HighlightRecord = {
      ...base,
      page: readPage(annotation.data),
      text: readStringValue(annotation.data.text, prior && 'text' in prior ? prior.text : ''),
      note: readNullableString(annotation.data.note),
      color: readNullableString(annotation.data.color),
      anchor: annotation.data.anchor ?? (prior && 'anchor' in prior ? prior.anchor : null),
      createdAt: readNumber(annotation.data.createdAt, prior?.createdAt ?? Date.now()),
      updatedAt: readNumber(annotation.data.updatedAt, prior?.updatedAt ?? Date.now()),
    };
    await database.putAccountRecord(owner.subject, owner.epoch, 'readerRecords', highlight);
  }

  // A server tombstone must remove a stale live local row, but the merge already
  // kept any row touched by pending work (it appears in `presentKeys`). Only rows
  // absent from the merge AND whose entity is tombstoned are soft-deleted.
  const tombstoned = new Set(result.tombstones.map((tombstone) => tombstone.entityId));
  const affected = await database.getAllByIndex<BookmarkRecord | HighlightRecord>(
    'readerRecords',
    'subjectBook',
    [owner.subject, bookId],
  );
  for (const row of affected) {
    if (row.deletedAt !== null || presentKeys.has(row.id)) continue;
    if (!isTombstonedRow(row, tombstoned)) continue;
    await database.putAccountRecord(owner.subject, owner.epoch, 'readerRecords', {
      ...row,
      deletedAt: Date.now(),
    });
  }
}

/** True when a live local row's server/client identity is in the tombstone set. */
function isTombstonedRow(
  row: BookmarkRecord | HighlightRecord,
  tombstoned: ReadonlySet<string>,
): boolean {
  const serverId = row.serverEntityId ?? null;
  return (
    (serverId !== null && tombstoned.has(serverId)) ||
    tombstoned.has(row.clientEntityId)
  );
}

function readContentVersion(data: Readonly<Record<string, unknown>>): number {
  const value = data.contentVersion;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Reads the real local annotation set for a book for the snapshot merge. */
export function createLocalAnnotationReader(database: OfflineDatabase): (
  subject: string,
  bookId: string,
) => Promise<readonly MergeAnnotation[]> {
  return async (subject, bookId) => {
    const rows = await database.getAllByIndex<BookmarkRecord | HighlightRecord>(
      'readerRecords',
      'subjectBook',
      [subject, bookId],
    );
    return rows.map((row) => toMergeAnnotation(row));
  };
}

/** Maps a durable reader record into the transport-agnostic merge view. */
function toMergeAnnotation(row: BookmarkRecord | HighlightRecord): MergeAnnotation {
  const serverEntityId = (row as { serverEntityId?: string | null }).serverEntityId ?? null;
  const isBookmark = 'label' in row;
  const clientEntityId = serverEntityId !== null && serverEntityId === row.clientEntityId ? null : row.clientEntityId;
  return {
    id: serverEntityId ?? row.clientEntityId,
    kind: isBookmark ? 'BOOKMARK' : 'ANNOTATION',
    clientEntityId,
    revision: row.revision,
    deletedAt: row.deletedAt,
    data: row as unknown as Readonly<Record<string, unknown>>,
  };
}

/** Persists a conflict copy returned directly by a CONFLICT dispatch outcome. */
export function createConflictCopyPersister(database: OfflineDatabase): (
  owner: { subject: string; epoch: number },
  operation: OutboxOperationRecord,
  outcome: Extract<OperationOutcome, { kind: 'CONFLICT' }>,
) => Promise<void> {
  return async (owner, operation, outcome) => {
    const copy = outcome.conflictCopy;
    if (!copy) return;
    const key = qualifyKey(owner.subject, 'conflict', copy.id);
    const existing = await database.get<StoredConflictCopyRecord>('conflicts', key);
    const record: StoredConflictCopyRecord = {
      ...copy,
      serverId: copy.id,
      id: key,
      subject: owner.subject,
      operationId: copy.operationId || operation.operationId,
      bookId: copy.bookId || operation.bookId,
      ...(existing
        ? { resolution: existing.resolution ?? null, resolvedAt: existing.resolvedAt ?? null }
        : {}),
    };
    await database.putAccountRecord(owner.subject, owner.epoch, 'conflicts', record);
  };
}

/** Reads the authoritative snapshot and projects it into the merge view. */
function createSnapshotSource(): SnapshotSource {
  return async (bookId: string): Promise<AuthoritativeSnapshot> => {
    const snapshot = await fetchAnnotationSnapshot(bookId);
    return {
      bookId: snapshot.bookId,
      snapshotRevision: snapshot.snapshotRevision,
      annotations: snapshot.annotations.map((row) => ({
        id: row.id,
        kind: row.__typename === 'BookmarkRecord' ? 'BOOKMARK' : 'ANNOTATION',
        clientEntityId: row.clientEntityId,
        revision: row.revision,
        deletedAt: null,
        data: row as unknown as Record<string, unknown>,
      })),
      tombstones: snapshot.tombstones.map((row) => ({
        entityId: row.entityId,
        kind: row.kind === 'BOOKMARK' ? 'BOOKMARK' : 'ANNOTATION',
        revision: row.revision,
        deletedAt: Date.parse(String(row.deletedAt)),
      })),
      conflictCopies: snapshot.conflictCopies.map((row) => ({
        id: row.id,
        subject: accountLifecycle().getOwner()?.subject ?? '',
        operationId: row.operationId,
        sourceEntityId: row.sourceEntityId,
        bookId: row.bookId,
        contentVersion: row.contentVersion,
        page: row.page,
        text: row.text,
        note: row.note,
        color: row.color,
        anchor: row.anchor,
        revision: row.revision,
        reason: row.reason,
        createdAt: Date.parse(String(row.createdAt)),
      })),
    };
  };
}

let shared: SyncCoordinator | null = null;

/** The single account-fenced coordinator for this tab. */
export function syncCoordinator(): SyncCoordinator {
  if (shared) return shared;
  const database = new OfflineDatabase();
  shared = new SyncCoordinator({
    store: createOutboxStore(database),
    receipts: createReceiptStore(database),
    send: async (input) => toOutcome(await dispatchReaderOperation(input as never)),
    lifecycle: {
      getOwner: () => accountLifecycle().getOwner(),
      requireReplayIdentity: () => accountLifecycle().requireReplayIdentity(),
    },
    snapshot: createSnapshotSource(),
    snapshotStore: createSnapshotStore(database),
    readLocalAnnotations: createLocalAnnotationReader(database),
    persistConflictCopy: createConflictCopyPersister(database),
    countLocalOnly: (subject) => countLocalOnlyRecords(database, subject),
    // The lease subject is resolved per acquire from the CURRENT owner, so a
    // coordinator built before auth (or surviving an account switch) never
    // holds the wrong subject's lease.
    lock: createSyncLock(() => accountLifecycle().getOwner()?.subject ?? null, tabId(), {
      persistence: createIndexedDbLeasePersistence(database),
      clock: { now: () => Date.now() },
      ttlMs: 30_000,
    }),
  });
  return shared;
}

/** Test seam: reset the lazy singleton without touching persisted records. */
export function resetSyncCoordinatorForTests(): void {
  shared = null;
}
