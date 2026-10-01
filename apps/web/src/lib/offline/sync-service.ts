'use client';

import { OfflineDatabase } from './database';
import { accountLifecycle } from './account-activation';
import { createIndexedDbLeasePersistence } from './database';
import { createSyncLock } from './coordination';
import { dispatchReaderOperation } from '../reader/api';
import { fetchAnnotationSnapshot } from '../reader/api';
import {
  SyncCoordinator,
  type OperationOutcome,
  type OutboxStore,
  type ReceiptStore,
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
function createOutboxStore(database: OfflineDatabase): OutboxStore {
  return {
    list: (subject) => database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', subject),
    remove: (id) => database.delete('outbox', id),
    update: (record) => database.putAccountRecord(record.subject, record.epoch, 'outbox', record),
  };
}

/**
 * Builds the real receipt store. `recordAndRemove` uses the Task 4
 * `acknowledgeOperation` primitive so the receipt and the acknowledged
 * operation's removal commit in ONE transaction.
 */
function createReceiptStore(database: OfflineDatabase): ReceiptStore {
  return {
    record: async () => {
      // A receipt must always be stored together with its operation removal;
      // the non-atomic path is intentionally unused in production.
      throw new Error('ReceiptStore.record must not be used; use recordAndRemove');
    },
    recordAndRemove: (outboxId, subject, epoch, receipt) =>
      database.acknowledgeOperation(subject, epoch, outboxId, receipt),
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
  const subject = accountLifecycle().getOwner()?.subject ?? '';
  shared = new SyncCoordinator({
    store: createOutboxStore(database),
    receipts: createReceiptStore(database),
    send: async (input) => toOutcome(await dispatchReaderOperation(input as never)),
    lifecycle: { getOwner: () => accountLifecycle().getOwner() },
    snapshot: createSnapshotSource(),
    lock: subject
      ? createSyncLock(subject, tabId(), {
          persistence: createIndexedDbLeasePersistence(database),
          clock: { now: () => Date.now() },
          ttlMs: 30_000,
        })
      : undefined,
  });
  return shared;
}

/** Test seam: reset the lazy singleton without touching persisted records. */
export function resetSyncCoordinatorForTests(): void {
  shared = null;
}
