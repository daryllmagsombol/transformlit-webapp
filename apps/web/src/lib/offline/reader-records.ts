import { OfflineDatabase } from './database';
import {
  OfflineStorageError,
  type AccountOwner,
  type BookmarkRecord,
  type HighlightRecord,
  type ProgressRecord,
  qualifyKey,
} from './contracts';import {
  coalesceProgress,
  nextLocalSequence,
  pendingProgressFor,
  queuedOperationsFor,
  type OutboxOperationKind,
  type OutboxOperationRecord,
} from './outbox';
import { accountLifecycle } from './account-activation';

/**
 * Result of one local-first reader mutation. `SAVED` means the local record and
 * its outbox operation committed in one IndexedDB transaction; the edit is now
 * durable on this device. It is explicitly NOT a server acknowledgement — online
 * synchronization is Task 11. `FAILED` means nothing was written.
 */
export interface ReaderSaveResult {
  readonly status: 'SAVED' | 'FAILED';
  readonly operationId: string | null;
  readonly error: string | null;
}

export interface ReaderRecordsDeps {
  readonly database: OfflineDatabase;
  /** Locally established owner; null means no private writes are permitted. */
  readonly getOwner: () => AccountOwner | null;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export interface ProgressInput {
  readonly bookId: string;
  readonly contentVersion: number;
  readonly currentPage: number;
  readonly scrollY: number | null;
}

export interface BookmarkAddInput {
  readonly bookId: string;
  readonly contentVersion: number;
  readonly page: number;
  /** Bookmark anchor is nullable (see contracts). */
  readonly anchor: unknown | null;
}

export interface BookmarkRemoveInput {
  readonly bookId: string;
  readonly contentVersion: number;
  readonly entityId: string;
  readonly baseRevision: number;
}

export interface HighlightCreateInput {
  readonly bookId: string;
  readonly contentVersion: number;
  readonly page: number;
  readonly text: string;
  readonly note: string | null;
  readonly color: string | null;
  readonly anchor: unknown;
}

export interface HighlightUpdateInput extends HighlightCreateInput {
  readonly entityId: string;
  readonly baseRevision: number;
}

export interface HighlightDeleteInput {
  readonly bookId: string;
  readonly contentVersion: number;
  readonly entityId: string;
  readonly baseRevision: number;
}

/** Fields a queued operation needs that are not derived from the entity key. */
interface QueueContext {
  readonly kind: OutboxOperationKind;
  readonly entityKey: string;
  readonly baseRevision: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The single durable entrypoint for reader mutations. Every write commits the
 * local record AND its outbox operation in one IndexedDB transaction (via
 * `OfflineDatabase.commitEditWithOutbox`); a transaction abort reports `FAILED`
 * and leaves no partial record or outbox operation behind.
 *
 * Bible content never passes through here — Bible navigation is a local
 * preference with no mutation/outbox path.
 */
export class ReaderRecords {
  private readonly database: OfflineDatabase;
  private readonly getOwner: () => AccountOwner | null;
  private readonly now: () => number;
  private readonly newId: () => string;
  /**
   * Serializes every mutation on this instance. Each mutation reads the outbox
   * to derive a base revision / dependency and then commits in a separate
   * IndexedDB transaction; without this chain two concurrent calls could both
   * take the coalesce path (or both append), breaking the single-coalesced-op
   * invariant. IndexedDB transactions alone cannot make the read-modify-write
   * atomic because the read and the write are separate transactions.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(deps: ReaderRecordsDeps) {
    this.database = deps.database;
    this.getOwner = deps.getOwner;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  }

  /**
   * Runs `task` after every previously enqueued mutation settles. The chain is
   * not poisoned by a rejection: the next task always runs regardless.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  // ── Progress ─────────────────────────────────────────────────────────────

  /**
   * Persists a deliberate page change locally and queues a PROGRESS_SET
   * operation. A newer unsent progress pair coalesces onto the existing unsent
   * operation (original id/operationId retained); a dispatched one is never
   * touched, and this always appends a new one instead.
   */
  async saveProgress(input: ProgressInput): Promise<ReaderSaveResult> {
    return this.enqueue(() => this.saveProgressLocked(input));
  }

  private async saveProgressLocked(input: ProgressInput): Promise<ReaderSaveResult> {
    try {
      const owner = this.getOwner();
      if (!owner) return this.failed(new OfflineStorageError('No established account owns this device'));
      const entityKey = qualifyKey(owner.subject, 'progress', input.bookId);
      const contentVersion = await this.resolveProgressContentVersion(owner, input.bookId, input.contentVersion);
      const record: ProgressRecord = {
        id: entityKey,
        subject: owner.subject,
        bookId: input.bookId,
        contentVersion,
        currentPage: input.currentPage,
        scrollY: input.scrollY,
        revision: 0,
        lastReadAt: this.now(),
      };

      const existing = await this.readOutbox(owner.subject);
      const pending = pendingProgressFor(existing, entityKey);
      const baseRevision = pending?.baseRevision ?? 0;
      const context: QueueContext = {
        kind: 'PROGRESS_SET',
        entityKey,
        baseRevision,
        payload: { currentPage: input.currentPage, scrollY: input.scrollY },
      };
      const operation = this.buildOperation(owner, input.bookId, contentVersion, context, existing);
      const decision = coalesceProgress(pending, operation);
      if (decision.action === 'REPLACE') {
        await this.database.commitEditWithOutbox({
          subject: owner.subject,
          epoch: owner.epoch,
          record,
          operation: decision.operation,
        });
        return { status: 'SAVED', operationId: decision.operation.operationId, error: null };
      }
      await this.database.commitEditWithOutbox({
        subject: owner.subject,
        epoch: owner.epoch,
        record,
        operation,
      });
      return { status: 'SAVED', operationId: operation.operationId, error: null };
    } catch (error) {
      return this.failed(error);
    }
  }

  /**
   * Resolves the content version stamped on a PROGRESS_SET operation.
   *
   * The server operation envelope requires a POSITIVE integer content version
   * and rejects `0` (it validates the value against the book's supported
   * versions). Progress is semantically content-version-independent, but the
   * envelope field is still required. Preference order:
   *  1. the caller's real content version when it is already positive
   *     (offline/pinned reading, or a future API-supplied version),
   *  2. the locally downloaded active version for this book,
   *  3. `1` as the minimal valid positive value.
   *
   * Task 11 is responsible for sending the server's CURRENT supported version
   * for progress (rather than trusting any stored placeholder) before dispatch.
   */
  async resolveProgressContentVersion(
    owner: AccountOwner,
    bookId: string,
    provided: number,
  ): Promise<number> {
    if (Number.isSafeInteger(provided) && provided >= 1) return provided;
    const active = await this.database.getActiveBookVersion(owner.subject, bookId);
    if (active && Number.isSafeInteger(active.contentVersion) && active.contentVersion >= 1) {
      return active.contentVersion;
    }
    return 1;
  }

  // ── Bookmarks (add/remove only) ───────────────────────────────────────────

  /** Creates a bookmark locally and queues a BOOKMARK_ADD. No label/color edit. */
  async addBookmark(input: BookmarkAddInput): Promise<ReaderSaveResult> {
    return this.enqueue(() => this.addBookmarkLocked(input));
  }

  private async addBookmarkLocked(input: BookmarkAddInput): Promise<ReaderSaveResult> {
    const owner = this.getOwner();
    if (!owner) return this.failed(new OfflineStorageError('No established account owns this device'));
    const clientEntityId = this.newId();
    const entityKey = qualifyKey(owner.subject, 'bookmark', clientEntityId);
    const record: BookmarkRecord = {
      id: entityKey,
      subject: owner.subject,
      clientEntityId,
      bookId: input.bookId,
      contentVersion: input.contentVersion,
      page: input.page,
      label: null,
      color: null,
      anchor: input.anchor,
      revision: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
      deletedAt: null,
    };
    return this.commitRecord(owner, input.bookId, input.contentVersion, entityKey, record, {
      kind: 'BOOKMARK_ADD',
      entityKey,
      baseRevision: null,
      payload: { clientEntityId, page: input.page, label: null, color: null, anchor: input.anchor },
    });
  }

  /** Soft-deletes a bookmark locally and queues a BOOKMARK_REMOVE. */
  async removeBookmark(input: BookmarkRemoveInput): Promise<ReaderSaveResult> {
    return this.enqueue(() => this.removeBookmarkLocked(input));
  }

  private async removeBookmarkLocked(input: BookmarkRemoveInput): Promise<ReaderSaveResult> {
    const owner = this.getOwner();
    if (!owner) return this.failed(new OfflineStorageError('No established account owns this device'));
    const entityKey = input.entityId;
    const existing = await this.database.get<BookmarkRecord>('readerRecords', entityKey);
    if (!existing || existing.subject !== owner.subject) {
      return { status: 'FAILED', operationId: null, error: 'Bookmark not found on this device' };
    }
    const record: BookmarkRecord = { ...existing, deletedAt: this.now(), revision: existing.revision + 1 };
    return this.commitRecord(owner, input.bookId, input.contentVersion, entityKey, record, {
      kind: 'BOOKMARK_REMOVE',
      entityKey,
      baseRevision: input.baseRevision,
      payload: { entityId: input.entityId, baseRevision: input.baseRevision },
    });
  }

  // ── Highlights / notes ────────────────────────────────────────────────────

  /** Creates a highlight (with its note) locally and queues an ANNOTATION_CREATE. */
  async createHighlight(input: HighlightCreateInput): Promise<ReaderSaveResult> {
    return this.enqueue(() => this.createHighlightLocked(input));
  }

  private async createHighlightLocked(input: HighlightCreateInput): Promise<ReaderSaveResult> {
    const owner = this.getOwner();
    if (!owner) return this.failed(new OfflineStorageError('No established account owns this device'));
    const clientEntityId = this.newId();
    const entityKey = qualifyKey(owner.subject, 'highlight', clientEntityId);
    const record: HighlightRecord = {
      id: entityKey,
      subject: owner.subject,
      clientEntityId,
      bookId: input.bookId,
      contentVersion: input.contentVersion,
      page: input.page,
      text: input.text,
      note: input.note,
      color: input.color,
      anchor: input.anchor,
      revision: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
      deletedAt: null,
    };
    return this.commitRecord(owner, input.bookId, input.contentVersion, entityKey, record, {
      kind: 'ANNOTATION_CREATE',
      entityKey,
      baseRevision: null,
      payload: {
        clientEntityId,
        page: input.page,
        text: input.text,
        note: input.note,
        color: input.color,
        anchor: input.anchor,
      },
    });
  }

  /** Updates a highlight/note locally and queues an ANNOTATION_UPDATE. */
  async updateHighlight(input: HighlightUpdateInput): Promise<ReaderSaveResult> {
    return this.enqueue(() => this.updateHighlightLocked(input));
  }

  private async updateHighlightLocked(input: HighlightUpdateInput): Promise<ReaderSaveResult> {
    const owner = this.getOwner();
    if (!owner) return this.failed(new OfflineStorageError('No established account owns this device'));
    const entityKey = input.entityId;
    const existing = await this.database.get<HighlightRecord>('readerRecords', entityKey);
    if (!existing || existing.subject !== owner.subject) {
      return { status: 'FAILED', operationId: null, error: 'Annotation not found on this device' };
    }
    const record: HighlightRecord = {
      ...existing,
      page: input.page,
      text: input.text,
      note: input.note,
      color: input.color,
      anchor: input.anchor,
      revision: existing.revision + 1,
      updatedAt: this.now(),
    };
    return this.commitRecord(owner, input.bookId, input.contentVersion, entityKey, record, {
      kind: 'ANNOTATION_UPDATE',
      entityKey,
      baseRevision: input.baseRevision,
      payload: {
        entityId: input.entityId,
        targetKind: 'ANNOTATION',
        baseRevision: input.baseRevision,
        page: input.page,
        text: input.text,
        note: input.note,
        color: input.color,
        anchor: input.anchor,
      },
    });
  }

  /** Soft-deletes a highlight locally and queues an ANNOTATION_DELETE. */
  async deleteHighlight(input: HighlightDeleteInput): Promise<ReaderSaveResult> {
    return this.enqueue(() => this.deleteHighlightLocked(input));
  }

  private async deleteHighlightLocked(input: HighlightDeleteInput): Promise<ReaderSaveResult> {
    const owner = this.getOwner();
    if (!owner) return this.failed(new OfflineStorageError('No established account owns this device'));
    const entityKey = input.entityId;
    const existing = await this.database.get<HighlightRecord>('readerRecords', entityKey);
    if (!existing || existing.subject !== owner.subject) {
      return { status: 'FAILED', operationId: null, error: 'Annotation not found on this device' };
    }
    const record: HighlightRecord = { ...existing, deletedAt: this.now(), revision: existing.revision + 1 };
    return this.commitRecord(owner, input.bookId, input.contentVersion, entityKey, record, {
      kind: 'ANNOTATION_DELETE',
      entityKey,
      baseRevision: input.baseRevision,
      payload: { entityId: input.entityId, baseRevision: input.baseRevision },
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getProgress(bookId: string): Promise<ProgressRecord | null> {
    const owner = this.getOwner();
    if (!owner) return null;
    return this.database.get<ProgressRecord>('readerRecords', qualifyKey(owner.subject, 'progress', bookId));
  }

  async listBookmarks(bookId: string): Promise<BookmarkRecord[]> {
    const owner = this.getOwner();
    if (!owner) return [];
    const rows = await this.database.getAllByIndex<BookmarkRecord>('readerRecords', 'subjectBook', [owner.subject, bookId]);
    return rows.filter((row) => row.deletedAt === null && isEntityKey(owner.subject, 'bookmark', row.id));
  }

  async listHighlights(bookId: string): Promise<HighlightRecord[]> {
    const owner = this.getOwner();
    if (!owner) return [];
    const rows = await this.database.getAllByIndex<HighlightRecord>('readerRecords', 'subjectBook', [owner.subject, bookId]);
    return rows.filter((row) => row.deletedAt === null && isEntityKey(owner.subject, 'highlight', row.id));
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async commitRecord(
    owner: AccountOwner,
    bookId: string,
    contentVersion: number,
    entityKey: string,
    record: BookmarkRecord | HighlightRecord,
    context: QueueContext,
  ): Promise<ReaderSaveResult> {
    try {
      const existing = await this.readOutbox(owner.subject);
      const operation = this.buildOperation(owner, bookId, contentVersion, context, existing, entityKey);
      await this.database.commitEditWithOutbox({
        subject: owner.subject,
        epoch: owner.epoch,
        record,
        operation,
      });
      return { status: 'SAVED', operationId: operation.operationId, error: null };
    } catch (error) {
      return this.failed(error);
    }
  }

  /**
   * Builds a durable outbox operation. When the same entity already has a queued
   * operation, the new one depends on it so an edit after an in-flight create is
   * ordered behind it and never shares its payload.
   */
  private buildOperation(
    owner: AccountOwner,
    bookId: string,
    contentVersion: number,
    context: QueueContext,
    existing: readonly OutboxOperationRecord[],
    entityKey = context.entityKey,
  ): OutboxOperationRecord {
    const operationId = this.newId();
    const queued = queuedOperationsFor(existing, entityKey);
    const predecessor = queued.length === 0
      ? null
      : queued.reduce((latest, current) => (current.seq > latest.seq ? current : latest));
    return {
      id: qualifyKey(owner.subject, 'outbox', operationId),
      subject: owner.subject,
      epoch: owner.epoch,
      operationId,
      entityKey,
      bookId,
      contentVersion,
      kind: context.kind,
      seq: nextLocalSequence(existing),
      dependsOn: context.kind === 'PROGRESS_SET' ? null : predecessor?.id ?? null,
      baseRevision: context.baseRevision,
      dispatchState: 'PENDING',
      attemptCount: 0,
      payload: context.payload,
      createdAt: this.now(),
    };
  }

  private async readOutbox(subject: string): Promise<OutboxOperationRecord[]> {
    return this.database.getAllByIndex<OutboxOperationRecord>('outbox', 'subject', subject);
  }

  private failed(error: unknown): ReaderSaveResult {
    const message = error instanceof Error ? error.message : 'Could not save on this device';
    return { status: 'FAILED', operationId: null, error: message };
  }
}

/**
 * True when a reader-record key is namespaced as `owner + entity + id` by
 * `qualifyKey`. This discriminates bookmarks from highlights by their explicit
 * key namespace rather than by which payload field happens to be present.
 */
function isEntityKey(subject: string, entity: 'bookmark' | 'highlight', id: string): boolean {
  return id.startsWith(qualifyKey(subject, entity, ''));
}

let shared: ReaderRecords | null = null;

/** Shared client instance backed by Task 4 IndexedDB and Task 13A identity. */
export function readerRecords(): ReaderRecords {
  shared ??= new ReaderRecords({
    database: new OfflineDatabase(),
    getOwner: () => accountLifecycle().getOwner(),
  });
  return shared;
}

/** Test seam: reset the lazy singleton without touching persisted records. */
export function resetReaderRecordsForTests(): void {
  shared = null;
}
