'use client';

import { OfflineDatabase, createIndexedDbLeasePersistence } from './database';
import { accountLifecycle } from './account-activation';
import { createSyncLock } from './coordination';
import { qualifyKey, type TombstoneRecord } from './contracts';
import type { StoredConflictCopyRecord } from './conflicts';

export type { StoredConflictCopyRecord } from './conflicts';
import { dispatchReaderOperation } from '../reader/api';
import { fetchAnnotationSnapshot } from '../reader/api';
import {
  SyncCoordinator,
  type BookMergeResult,
  type OperationOutcome,
  type OutboxStore,
  type ReceiptStore,
  type SnapshotApplyStore,
  type SnapshotSource,
} from './sync-coordinator';
import type { OutboxOperationRecord } from './outbox';
import type { AuthoritativeSnapshot } from './snapshot-merge';

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
    case 'ReaderOperationConflict':
      return {
        kind: 'CONFLICT',
        entityId: variant.entityId,
        serverRevision: variant.serverRevision,
        serverValue: variant.serverValue,
        conflictCopyId: variant.conflictCopy?.id ?? null,
      };
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
 * surfaced (not silently dropped). Server-annotation projection into the
 * individual `readerRecords` rows is intentionally deferred: local reads
 * discriminate by subject-qualified keys, so merging raw server rows requires a
 * separate projection (recorded in the Task 11 report).
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
      for (const conflict of result.conflictCopies) {
        // `id` becomes the storage key; the stable server identity is preserved
        // as `serverId` so a retarget can still reference it.
        const record: StoredConflictCopyRecord = {
          ...conflict,
          serverId: conflict.id,
          id: qualifyKey(owner.subject, 'conflict', conflict.id),
          subject: owner.subject,
        };
        await database.putAccountRecord(owner.subject, owner.epoch, 'conflicts', record);
      }
    },
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
    lifecycle: { getOwner: () => accountLifecycle().getOwner() },
    snapshot: createSnapshotSource(),
    snapshotStore: createSnapshotStore(database),
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
