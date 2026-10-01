import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BooksService } from './books.service.js';
import {
  ConflictReason,
  OperationKind,
  OperationTargetKind,
  ReaderOperationInput,
} from './models/book.model.js';

export { UPGRADE_REQUIRED_CODE, UpgradeRequiredError } from './reader-mutation.errors.js';

export type OperationResultPayload =
  | { kind: 'APPLIED'; entityId: string; revision: number; receiptId: string }
  | {
      kind: 'CONFLICT';
      entityId: string;
      serverRevision: number;
      serverValue: Record<string, unknown>;
      conflictCopy: Record<string, unknown> | null;
    }
  | { kind: 'INCOMPATIBLE_VERSION'; requestedContentVersion: number; supportedContentVersions: number[] }
  | { kind: 'ACCESS_DENIED'; resourceId: string; reason: string };

export interface ReaderOperationOutcome {
  operationId: string;
  result: OperationResultPayload;
}

/** One transactionally consistent, annotation-only per-book snapshot. */
export interface AnnotationSnapshot {
  bookId: string;
  snapshotRevision: number;
  annotations: Record<string, unknown>[];
  tombstones: Record<string, unknown>[];
  conflictCopies: Record<string, unknown>[];
}

/** Canonical UUID v4-style check; client identity must be well-formed. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fields allowed for a given kind; everything else must be absent. */
const KIND_FIELDS: Record<OperationKind, readonly string[]> = {
  [OperationKind.PROGRESS_SET]: ['baseRevision', 'currentPage', 'scrollY'],
  [OperationKind.BOOKMARK_ADD]: ['clientEntityId', 'page', 'label', 'color', 'anchor'],
  [OperationKind.BOOKMARK_REMOVE]: ['entityId', 'baseRevision'],
  [OperationKind.ANNOTATION_CREATE]: ['clientEntityId', 'page', 'text', 'note', 'color', 'anchor'],
  [OperationKind.ANNOTATION_UPDATE]: ['entityId', 'targetKind', 'baseRevision', 'page', 'text', 'note', 'color', 'anchor'],
  [OperationKind.ANNOTATION_DELETE]: ['entityId', 'baseRevision'],
};

/**
 * Fields that must be present for a kind. Nullable fields (label/color/note/
 * scrollY) may be omitted; the server treats omission as null. Non-nullable
 * fields must always be supplied so an ambiguous request is never applied.
 */
const REQUIRED_FIELDS: Record<OperationKind, readonly string[]> = {
  [OperationKind.PROGRESS_SET]: ['baseRevision', 'currentPage'],
  [OperationKind.BOOKMARK_ADD]: ['clientEntityId', 'page'],
  [OperationKind.BOOKMARK_REMOVE]: ['entityId', 'baseRevision'],
  [OperationKind.ANNOTATION_CREATE]: ['clientEntityId', 'page', 'text'],
  [OperationKind.ANNOTATION_UPDATE]: ['entityId', 'targetKind', 'baseRevision', 'page', 'text'],
  [OperationKind.ANNOTATION_DELETE]: ['entityId', 'baseRevision'],
};

/** Every envelope field the server understands (presence is validated per kind). */
const ENVELOPE_FIELDS = [
  'entityId',
  'clientEntityId',
  'targetKind',
  'baseRevision',
  'currentPage',
  'scrollY',
  'page',
  'label',
  'color',
  'anchor',
  'text',
  'note',
] as const;

/**
 * Extra attempts to observe a concurrently-committed winner receipt. A
 * unique-violation only fires after the winning transaction commits, so the
 * winner is normally visible immediately; this bounded retry covers a replica /
 * pooler read-your-writes lag without unbounded waiting.
 */
const REPLAY_READ_ATTEMPTS = 5;
const REPLAY_BACKOFF_MS = 15;
/** Stable, retryable code surfaced when a concurrent winner cannot be observed. */
export const CONCURRENT_OPERATION_CODE = 'CONCURRENT_OPERATION_IN_PROGRESS';

interface NormalizedAnchor {
  version: number;
  page: number;
  startOffset: number;
  endOffset: number;
}

interface NormalizedOperation {
  operationId: string;
  bookId: string;
  contentVersion: number;
  kind: OperationKind;
  entityId: string | null;
  clientEntityId: string | null;
  targetKind: OperationTargetKind | null;
  baseRevision: number | null;
  currentPage: number | null;
  scrollY: number | null;
  page: number | null;
  label: string | null;
  color: string | null;
  anchor: NormalizedAnchor | null;
  text: string | null;
  note: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toJsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

@Injectable()
export class ReaderMutationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
  ) {}

  /**
   * Replay-safe entry point for every queued reader operation.
   *
   * The mutation, any conflict copy, and the dedup receipt commit in one
   * transaction. If a concurrent transaction already claimed the receipt (or the
   * entity's unique client identity), our transaction is aborted by the unique
   * violation, and we re-read the winner's durable receipt and return its stored
   * logical result instead of committing a divergent mutation.
   */
  async applyOperation(subject: string, rawInput: ReaderOperationInput): Promise<ReaderOperationOutcome> {
    const input = this.validateOperation(rawInput);
    const payloadHash = this.hashPayload(input);

    try {
      return await this.prisma.$transaction((tx) => this.execute(tx, subject, input, payloadHash));
    } catch (error) {
      const replay = await this.replayAfterConflict(subject, input, payloadHash, error);
      if (replay) return replay;
      throw error;
    }
  }

  /**
   * Authoritative, transactionally-consistent, annotation-only snapshot.
   *
   * Reading is one `RepeatableRead` transaction, so all three collections share
   * a single boundary. Present bookmarks/highlights are returned as
   * `annotations`; deleted identities are returned as `tombstones` (scoped to
   * this book by joining the tombstone `entityId` to the book's rows, since the
   * tombstone model carries no `bookId`); linked conflict copies are returned
   * with their current revision. Progress is intentionally excluded — it is a
   * separate revisioned endpoint — so this is never a complete all-reader
   * snapshot.
   *
   * `snapshotRevision` is a monotonic per-book annotation watermark: the highest
   * revision observed among this book's annotations, tombstones, and conflict
   * copies (0 when there are none). It never decreases and never advances from a
   * progress write. Clients still merge by stable entity ID/revision; the
   * watermark alone is not a change detector.
   */
  async getSnapshot(subject: string, bookId: string): Promise<AnnotationSnapshot> {
    return this.prisma.$transaction(
      async (tx) => {
        const book = await tx.book.findUnique({ where: { id: bookId } });
        if (!book || book.deletedAt) throw new NotFoundException('Book not available');
        if (!(await this.books.canRead(book, subject, tx))) {
          throw new ForbiddenException('You do not have access to this book');
        }

        const [bookmarks, highlights, copies] = await Promise.all([
          tx.bookmark.findMany({ where: { userId: subject, bookId, deletedAt: null } }),
          tx.highlight.findMany({ where: { userId: subject, bookId, deletedAt: null } }),
          tx.conflictCopy.findMany({ where: { subject, bookId } }),
        ]);

        // Tombstones are keyed by subject + entityId only; scope them to this
        // book by the ids of its (including soft-deleted) rows.
        const [deletedBookmarks, deletedHighlights] = await Promise.all([
          tx.bookmark.findMany({ where: { userId: subject, bookId, deletedAt: { not: null } }, select: { id: true } }),
          tx.highlight.findMany({ where: { userId: subject, bookId, deletedAt: { not: null } }, select: { id: true } }),
        ]);
        const scopedEntityIds = [...deletedBookmarks, ...deletedHighlights].map((row) => row.id);
        const tombstones = scopedEntityIds.length === 0
          ? []
          : await tx.readerTombstone.findMany({ where: { subject, entityId: { in: scopedEntityIds } } });

        const annotations = [
          ...bookmarks.map((row) => this.bookmarkValue(row as unknown as Record<string, unknown>)),
          ...highlights.map((row) => this.highlightValue(row as unknown as Record<string, unknown>)),
        ];
        const tombstoneValues = tombstones.map((row) => ({
          __typename: 'ReaderTombstone',
          entityId: row.entityId,
          kind: row.kind,
          revision: row.revision,
          deletedAt: row.deletedAt,
        }));
        const copyValues = copies.map((row) => this.conflictCopyValue(row as unknown as Record<string, unknown>));

        const revisions = [
          ...bookmarks.map((row) => row.revision),
          ...highlights.map((row) => row.revision),
          ...tombstones.map((row) => row.revision),
          ...copies.map((row) => row.revision),
        ];
        const snapshotRevision = revisions.length === 0 ? 0 : Math.max(...revisions);

        return { bookId, snapshotRevision, annotations, tombstones: tombstoneValues, conflictCopies: copyValues };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async execute(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    payloadHash: string,
  ): Promise<ReaderOperationOutcome> {
    const prior = await tx.readerOperationReceipt.findUnique({
      where: { subject_operationId: { subject, operationId: input.operationId } },
    });
    if (prior) return this.replayOutcome(input.operationId, prior.payloadHash, payloadHash, prior.result);

    const access = await this.resolveAccess(tx, input.bookId, subject);
    if (!access.allowed) {
      // Terminal until state changes: intentionally NOT receipted, so a later
      // replay after access/version state changes is re-evaluated rather than
      // frozen (see docs/superpowers/specs/2026-10-01-pwa-contracts.md).
      return { operationId: input.operationId, result: { kind: 'ACCESS_DENIED', resourceId: input.bookId, reason: access.reason } };
    }
    if (!access.supportedContentVersions.includes(input.contentVersion)) {
      return {
        operationId: input.operationId,
        result: {
          kind: 'INCOMPATIBLE_VERSION',
          requestedContentVersion: input.contentVersion,
          supportedContentVersions: access.supportedContentVersions,
        },
      };
    }

    const receiptId = randomUUID();
    const result = await this.dispatch(tx, subject, input, receiptId);
    if (result.kind === 'APPLIED' || result.kind === 'CONFLICT') {
      await tx.readerOperationReceipt.create({
        data: { id: receiptId, subject, operationId: input.operationId, payloadHash, result: result as unknown as Prisma.InputJsonValue },
      });
    }
    return { operationId: input.operationId, result };
  }

  /**
   * After a unique violation rolled back our transaction, adopt the winner's
   * durable result. Returns null only when the violation was not a dedup race
   * we can reconcile, letting the caller surface it.
   */
  private async replayAfterConflict(
    subject: string,
    input: NormalizedOperation,
    payloadHash: string,
    error: unknown,
  ): Promise<ReaderOperationOutcome | null> {
    if (!isUniqueViolation(error)) return null;
    for (let attempt = 0; attempt < REPLAY_READ_ATTEMPTS; attempt += 1) {
      const winner = await this.prisma.readerOperationReceipt.findUnique({
        where: { subject_operationId: { subject, operationId: input.operationId } },
      });
      if (winner) return this.replayOutcome(input.operationId, winner.payloadHash, payloadHash, winner.result);
      await new Promise((resolve) => setTimeout(resolve, REPLAY_BACKOFF_MS));
    }
    // A unique violation we cannot map to a receipt is a genuine concurrent
    // entity conflict, not an opaque 500: report it as a clearly retryable
    // conflict with a stable code so clients can retry rather than discard.
    throw new ConflictException({
      message: 'Concurrent operation in progress for this operationId; retry',
      code: CONCURRENT_OPERATION_CODE,
    });
  }

  private replayOutcome(
    operationId: string,
    storedHash: string,
    payloadHash: string,
    storedResult: unknown,
  ): ReaderOperationOutcome {
    if (storedHash !== payloadHash) {
      throw new BadRequestException('operationId was already used with a different payload');
    }
    return { operationId, result: storedResult as OperationResultPayload };
  }

  private async resolveAccess(
    tx: Prisma.TransactionClient,
    bookId: string,
    subject: string,
  ): Promise<{ allowed: boolean; reason: string; supportedContentVersions: number[] }> {
    const book = await tx.book.findUnique({ where: { id: bookId } });
    if (!book || book.deletedAt) return { allowed: false, reason: 'Book not available', supportedContentVersions: [] };
    const allowed = await this.books.canRead(book, subject, tx);
    if (!allowed) return { allowed: false, reason: 'You do not have access to this book', supportedContentVersions: [] };

    const versions = await tx.bookContentVersion.findMany({
      where: { bookId },
      select: { contentVersion: true },
    });
    const supported = new Set<number>(versions.map((row) => row.contentVersion));
    supported.add(book.contentVersion);
    return { allowed: true, reason: '', supportedContentVersions: [...supported].sort((a, b) => a - b) };
  }

  private async dispatch(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    switch (input.kind) {
      case OperationKind.PROGRESS_SET:
        return this.applyProgress(tx, subject, input, receiptId);
      case OperationKind.BOOKMARK_ADD:
        return this.applyBookmarkAdd(tx, subject, input, receiptId);
      case OperationKind.BOOKMARK_REMOVE:
        return this.applyBookmarkRemove(tx, subject, input, receiptId);
      case OperationKind.ANNOTATION_CREATE:
        return this.applyAnnotationCreate(tx, subject, input, receiptId);
      case OperationKind.ANNOTATION_UPDATE:
        return this.applyAnnotationUpdate(tx, subject, input, receiptId);
      case OperationKind.ANNOTATION_DELETE:
        return this.applyAnnotationDelete(tx, subject, input, receiptId);
      default:
        throw new BadRequestException('Unsupported operation kind');
    }
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  private async applyProgress(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const baseRevision = input.baseRevision as number;
    const existing = await tx.bookProgress.findUnique({
      where: { userId_bookId: { userId: subject, bookId: input.bookId } },
    });

    if (!existing) {
      if (baseRevision !== 0) {
        return this.conflict(input.bookId, 0, this.emptyProgressValue(input), null);
      }
      // Conditional create: a concurrent create loses the (userId, bookId)
      // unique constraint and is reconciled through the receipt replay path.
      const created = await tx.bookProgress.create({
        data: { userId: subject, bookId: input.bookId, currentPage: input.currentPage as number, scrollY: input.scrollY, revision: 1 },
      });
      return { kind: 'APPLIED', entityId: created.id, revision: created.revision, receiptId };
    }

    if (existing.revision !== baseRevision) {
      return this.conflict(input.bookId, existing.revision, this.progressValue(existing), null);
    }

    // DB-conditional write: only advances if the revision is still baseRevision.
    const result = await tx.bookProgress.updateMany({
      where: { id: existing.id, userId: subject, revision: baseRevision },
      data: { currentPage: input.currentPage as number, scrollY: input.scrollY, lastReadAt: new Date(), revision: { increment: 1 } },
    });
    if (result.count === 0) return this.staleProgressConflict(tx, subject, input);

    return { kind: 'APPLIED', entityId: existing.id, revision: baseRevision + 1, receiptId };
  }

  private async staleProgressConflict(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
  ): Promise<OperationResultPayload> {
    const fresh = await tx.bookProgress.findUnique({ where: { userId_bookId: { userId: subject, bookId: input.bookId } } });
    return this.conflict(input.bookId, fresh?.revision ?? 0, fresh ? this.progressValue(fresh) : this.emptyProgressValue(input), null);
  }

  // ── Bookmarks ─────────────────────────────────────────────────────────────

  private async applyBookmarkAdd(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const clientEntityId = input.clientEntityId as string;
    const existing = await tx.bookmark.findUnique({
      where: { userId_clientEntityId: { userId: subject, clientEntityId } },
    });
    if (existing?.deletedAt) {
      // A tombstoned identity can never be resurrected by a delayed add/retry.
      return this.conflict(input.bookId, existing.revision, this.bookmarkValue(existing), null);
    }
    if (existing) {
      if (this.bookmarkMatches(existing, input)) {
        return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
      }
      // Same client identity with different content is a real conflict, not a
      // silent overwrite; the existing row is the server value.
      return this.conflict(input.bookId, existing.revision, this.bookmarkValue(existing), null);
    }

    const created = await tx.bookmark.create({
      data: {
        userId: subject,
        bookId: input.bookId,
        clientEntityId,
        page: input.page as number,
        label: input.label,
        color: input.color,
        anchor: toJsonOrDbNull(input.anchor),
        contentVersion: input.contentVersion,
        revision: 1,
      },
    });
    return { kind: 'APPLIED', entityId: created.id, revision: created.revision, receiptId };
  }

  private async applyBookmarkRemove(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const entityId = input.entityId as string;
    // Scope to the declared book so a stale/cross-book op cannot touch it.
    const existing = await tx.bookmark.findFirst({ where: { id: entityId, userId: subject, bookId: input.bookId } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Bookmark not found for this account and book' };
    }
    if (existing.deletedAt) {
      return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
    }
    const baseRevision = input.baseRevision as number;
    if (existing.revision !== baseRevision) {
      return this.conflict(input.bookId, existing.revision, this.bookmarkValue(existing), null);
    }

    const result = await tx.bookmark.updateMany({
      where: { id: existing.id, userId: subject, bookId: input.bookId, revision: baseRevision },
      data: { deletedAt: new Date(), revision: { increment: 1 } },
    });
    if (result.count === 0) return this.staleEntityConflict(tx, subject, 'bookmark', input, existing.id, existing);

    await this.upsertTombstone(tx, subject, existing.id, 'BOOKMARK', baseRevision + 1);
    return { kind: 'APPLIED', entityId: existing.id, revision: baseRevision + 1, receiptId };
  }

  // ── Annotations (highlights) ──────────────────────────────────────────────

  private async applyAnnotationCreate(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const clientEntityId = input.clientEntityId as string;
    const existing = await tx.highlight.findUnique({
      where: { userId_clientEntityId: { userId: subject, clientEntityId } },
    });
    if (existing?.deletedAt) {
      return this.conflict(input.bookId, existing.revision, this.highlightValue(existing), null);
    }
    if (existing) {
      if (this.highlightMatches(existing, input)) {
        return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
      }
      return this.conflict(input.bookId, existing.revision, this.highlightValue(existing), null);
    }

    const created = await tx.highlight.create({
      data: {
        userId: subject,
        bookId: input.bookId,
        clientEntityId,
        page: input.page as number,
        text: input.text as string,
        note: input.note,
        color: input.color,
        anchor: toJsonOrDbNull(input.anchor),
        contentVersion: input.contentVersion,
        revision: 1,
      },
    });
    return { kind: 'APPLIED', entityId: created.id, revision: created.revision, receiptId };
  }

  private async applyAnnotationUpdate(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    if (input.targetKind === OperationTargetKind.CONFLICT_COPY) {
      return this.updateConflictCopy(tx, subject, input, receiptId);
    }
    const entityId = input.entityId as string;
    const existing = await tx.highlight.findFirst({ where: { id: entityId, userId: subject, bookId: input.bookId } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Annotation not found for this account and book' };
    }
    const baseRevision = input.baseRevision as number;

    if (existing.deletedAt) {
      // Edit-after-delete: keep deletion history AND the attempted edit.
      const copy = await this.createConflictCopy(tx, subject, input, existing.id, input.bookId, ConflictReason.DELETE_VS_EDIT, this.editFields(input));
      return this.conflict(input.bookId, existing.revision, this.highlightValue(existing), copy);
    }
    if (existing.revision !== baseRevision) {
      const copy = await this.createConflictCopy(tx, subject, input, existing.id, input.bookId, ConflictReason.STALE_REVISION, this.editFields(input));
      return this.conflict(input.bookId, existing.revision, this.highlightValue(existing), copy);
    }

    const result = await tx.highlight.updateMany({
      where: { id: existing.id, userId: subject, bookId: input.bookId, revision: baseRevision },
      data: {
        page: input.page as number,
        text: input.text as string,
        note: input.note,
        color: input.color,
        anchor: toJsonOrDbNull(input.anchor),
        revision: { increment: 1 },
      },
    });
    if (result.count === 0) return this.staleEntityConflict(tx, subject, 'highlight', input, existing.id, existing);

    return { kind: 'APPLIED', entityId: existing.id, revision: baseRevision + 1, receiptId };
  }

  private async updateConflictCopy(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const entityId = input.entityId as string;
    const existing = await tx.conflictCopy.findFirst({ where: { id: entityId, subject, bookId: input.bookId } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Conflict copy not found for this account and book' };
    }
    const baseRevision = input.baseRevision as number;
    const sourceEntityId = existing.sourceEntityId ?? existing.id;
    if (existing.revision !== baseRevision) {
      const copy = await this.createConflictCopy(tx, subject, input, sourceEntityId, existing.bookId, ConflictReason.STALE_REVISION, this.editFields(input));
      return this.conflict(existing.bookId, existing.revision, this.conflictCopyValue(existing), copy);
    }

    const result = await tx.conflictCopy.updateMany({
      where: { id: existing.id, subject, bookId: existing.bookId, revision: baseRevision },
      data: {
        page: input.page as number,
        text: input.text as string,
        note: input.note,
        color: input.color,
        anchor: toJsonOrDbNull(input.anchor),
        revision: { increment: 1 },
      },
    });
    if (result.count === 0) {
      const fresh = await tx.conflictCopy.findFirst({ where: { id: existing.id, subject, bookId: existing.bookId } });
      // The row was read at `baseRevision` but the conditional update matched
      // nothing: a concurrent write advanced it between read and write. Preserve
      // BOTH sides — the newer server copy and this offline edit — by minting a
      // fresh conflict copy, and never return CONFLICT with a null copy for an
      // update (the contract requires a non-null copy for retarget conflicts).
      const current = fresh ?? existing;
      const sourceEntityId = current.sourceEntityId ?? current.id;
      const copy = await this.createConflictCopy(tx, subject, input, sourceEntityId, existing.bookId, ConflictReason.STALE_REVISION, this.editFields(input));
      return this.conflict(existing.bookId, (current.revision as number) ?? existing.revision, this.conflictCopyValue(current), copy);
    }

    return { kind: 'APPLIED', entityId: existing.id, revision: baseRevision + 1, receiptId };
  }

  private async applyAnnotationDelete(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const entityId = input.entityId as string;
    const existing = await tx.highlight.findFirst({ where: { id: entityId, userId: subject, bookId: input.bookId } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Annotation not found for this account and book' };
    }
    const baseRevision = input.baseRevision as number;
    if (existing.deletedAt) {
      return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
    }
    if (existing.revision !== baseRevision) {
      // Stale delete-after-edit: preserve the newer edit and record the delete
      // intent as a copy of the current server annotation (honest content, not
      // fabricated from the delete request, which carries no text/page).
      const copy = await this.createConflictCopy(
        tx,
        subject,
        input,
        existing.id,
        input.bookId,
        ConflictReason.DELETE_VS_EDIT,
        this.highlightFields(existing),
      );
      return this.conflict(input.bookId, existing.revision, this.highlightValue(existing), copy);
    }

    const result = await tx.highlight.updateMany({
      where: { id: existing.id, userId: subject, bookId: input.bookId, revision: baseRevision },
      data: { deletedAt: new Date(), revision: { increment: 1 } },
    });
    if (result.count === 0) return this.staleEntityConflict(tx, subject, 'highlight', input, existing.id, existing);

    await this.upsertTombstone(tx, subject, existing.id, 'ANNOTATION', baseRevision + 1);
    return { kind: 'APPLIED', entityId: existing.id, revision: baseRevision + 1, receiptId };
  }

  private async staleEntityConflict(
    tx: Prisma.TransactionClient,
    subject: string,
    entity: 'bookmark' | 'highlight',
    input: NormalizedOperation,
    entityId: string,
    known: Record<string, unknown>,
  ): Promise<OperationResultPayload> {
    // Scope to the authenticated subject as well as the book: the follow-up
    // read must never surface another account's row as `serverValue`.
    const fresh = entity === 'bookmark'
      ? await tx.bookmark.findFirst({ where: { id: entityId, userId: subject, bookId: input.bookId } })
      : await tx.highlight.findFirst({ where: { id: entityId, userId: subject, bookId: input.bookId } });
    const row = (fresh as Record<string, unknown> | null) ?? known;
    const value = entity === 'bookmark' ? this.bookmarkValue(row) : this.highlightValue(row);
    return this.conflict(input.bookId, (row.revision as number) ?? 1, value, null);
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async upsertTombstone(
    tx: Prisma.TransactionClient,
    subject: string,
    entityId: string,
    kind: 'BOOKMARK' | 'ANNOTATION',
    revision: number,
  ): Promise<void> {
    await tx.readerTombstone.upsert({
      where: { subject_entityId: { subject, entityId } },
      update: { revision, deletedAt: new Date() },
      create: { subject, entityId, kind, revision },
    });
  }

  private editFields(input: NormalizedOperation): ConflictFields {
    return { page: input.page, text: input.text, note: input.note, color: input.color, anchor: input.anchor };
  }

  private highlightFields(row: Record<string, unknown>): ConflictFields {
    return {
      page: (row.page as number) ?? null,
      text: (row.text as string) ?? null,
      note: (row.note as string | null) ?? null,
      color: (row.color as string | null) ?? null,
      anchor: (row.anchor as NormalizedAnchor | null) ?? null,
    };
  }

  private async createConflictCopy(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    sourceEntityId: string,
    bookId: string,
    reason: ConflictReason,
    fields: ConflictFields,
  ): Promise<Record<string, unknown>> {
    const copy = await tx.conflictCopy.create({
      data: {
        subject,
        operationId: input.operationId,
        sourceEntityId,
        bookId,
        contentVersion: input.contentVersion,
        page: (fields.page ?? 1) as number,
        text: (fields.text ?? '') as string,
        note: fields.note,
        color: fields.color,
        anchor: toJsonOrDbNull(fields.anchor),
        revision: 1,
        reason,
      },
    });
    return this.conflictCopyValue(copy);
  }

  private conflict(
    _bookId: string,
    serverRevision: number,
    serverValue: Record<string, unknown>,
    conflictCopy: Record<string, unknown> | null,
  ): OperationResultPayload {
    return {
      kind: 'CONFLICT',
      entityId: String(serverValue.id ?? serverValue.bookId ?? ''),
      serverRevision,
      serverValue,
      conflictCopy,
    };
  }

  private progressValue(row: { bookId: string; currentPage: number; scrollY: number | null; revision: number; lastReadAt: Date }): Record<string, unknown> {
    return {
      __typename: 'ProgressRecord',
      bookId: row.bookId,
      currentPage: row.currentPage,
      scrollY: row.scrollY,
      revision: row.revision,
      lastReadAt: row.lastReadAt,
    };
  }

  private emptyProgressValue(input: NormalizedOperation): Record<string, unknown> {
    return { __typename: 'ProgressRecord', bookId: input.bookId, currentPage: 1, scrollY: null, revision: 0, lastReadAt: new Date() };
  }

  private bookmarkValue(row: Record<string, unknown>): Record<string, unknown> {
    return {
      __typename: 'BookmarkRecord',
      id: row.id,
      clientEntityId: row.clientEntityId ?? null,
      bookId: row.bookId,
      page: row.page,
      label: row.label ?? null,
      color: row.color ?? null,
      anchor: row.anchor ?? null,
      contentVersion: row.contentVersion ?? 1,
      revision: row.revision ?? 1,
      createdAt: row.createdAt ?? new Date(),
      deletedAt: row.deletedAt ?? null,
    };
  }

  private highlightValue(row: Record<string, unknown>): Record<string, unknown> {
    return {
      __typename: 'HighlightRecord',
      id: row.id,
      clientEntityId: row.clientEntityId ?? null,
      bookId: row.bookId,
      page: row.page,
      text: row.text,
      note: row.note ?? null,
      color: row.color ?? null,
      anchor: row.anchor ?? null,
      contentVersion: row.contentVersion ?? 1,
      revision: row.revision ?? 1,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: row.updatedAt ?? new Date(),
      deletedAt: row.deletedAt ?? null,
    };
  }

  private conflictCopyValue(row: Record<string, unknown>): Record<string, unknown> {
    return {
      __typename: 'ConflictCopy',
      id: row.id,
      operationId: row.operationId,
      sourceEntityId: row.sourceEntityId,
      bookId: row.bookId,
      contentVersion: row.contentVersion,
      page: row.page,
      text: row.text,
      note: row.note ?? null,
      color: row.color ?? null,
      anchor: row.anchor ?? null,
      revision: row.revision ?? 1,
      reason: row.reason,
      createdAt: row.createdAt ?? new Date(),
    };
  }

  private bookmarkMatches(row: Record<string, unknown>, input: NormalizedOperation): boolean {
    return row.page === input.page
      && (row.label ?? null) === input.label
      && (row.color ?? null) === input.color
      && JSON.stringify(row.anchor ?? null) === JSON.stringify(input.anchor ?? null);
  }

  private highlightMatches(row: Record<string, unknown>, input: NormalizedOperation): boolean {
    return row.page === input.page
      && row.text === input.text
      && (row.note ?? null) === input.note
      && (row.color ?? null) === input.color
      && JSON.stringify(row.anchor ?? null) === JSON.stringify(input.anchor ?? null);
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /** Canonical, order-stable payload used for dedup hashing. */
  hashPayload(input: NormalizedOperation): string {
    const canonical = {
      bookId: input.bookId,
      contentVersion: input.contentVersion,
      kind: input.kind,
      entityId: input.entityId,
      clientEntityId: input.clientEntityId,
      targetKind: input.targetKind,
      baseRevision: input.baseRevision,
      currentPage: input.currentPage,
      scrollY: input.scrollY,
      page: input.page,
      label: input.label,
      color: input.color,
      anchor: input.anchor,
      text: input.text,
      note: input.note,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /**
   * Validates the flattened envelope and returns a normalized operation. Exact
   * per-kind field presence is enforced: every field not listed for the kind
   * must be absent, and every required field must be present (nullable ones may
   * be omitted or null). UUID/ID formats, positive integers, finite numbers,
   * non-empty strings and the anchor rules are all checked before anything is
   * applied.
   */
  validateOperation(raw: ReaderOperationInput): NormalizedOperation {
    if (!raw || typeof raw !== 'object') throw new BadRequestException('Operation input is required');
    if (typeof raw.operationId !== 'string' || !UUID_PATTERN.test(raw.operationId)) {
      throw new BadRequestException('operationId must be a UUID');
    }
    if (typeof raw.bookId !== 'string' || raw.bookId.length === 0) {
      throw new BadRequestException('bookId is required');
    }
    if (!Number.isInteger(raw.contentVersion) || (raw.contentVersion as number) < 1) {
      throw new BadRequestException('contentVersion must be a positive integer');
    }
    if (!Object.values(OperationKind).includes(raw.kind)) {
      throw new BadRequestException('kind is not a supported operation');
    }

    const kind = raw.kind;
    const allowed = new Set(KIND_FIELDS[kind]);
    const rawRecord = raw as unknown as Record<string, unknown>;
    for (const field of ENVELOPE_FIELDS) {
      const value = rawRecord[field];
      const present = value !== undefined && value !== null;
      if (present && !allowed.has(field)) {
        throw new BadRequestException(`Field "${field}" is not allowed for kind ${kind}`);
      }
    }
    for (const field of REQUIRED_FIELDS[kind]) {
      if (!(field in raw) || rawRecord[field] === undefined || rawRecord[field] === null) {
        throw new BadRequestException(`Field "${field}" is required for kind ${kind}`);
      }
    }

    const normalized: NormalizedOperation = {
      operationId: raw.operationId,
      bookId: raw.bookId,
      contentVersion: raw.contentVersion as number,
      kind,
      entityId: raw.entityId ?? null,
      clientEntityId: raw.clientEntityId ?? null,
      targetKind: raw.targetKind ?? null,
      baseRevision: raw.baseRevision ?? null,
      currentPage: raw.currentPage ?? null,
      scrollY: raw.scrollY ?? null,
      page: raw.page ?? null,
      label: raw.label ?? null,
      color: raw.color ?? null,
      anchor: raw.anchor ? this.validateAnchor(raw.anchor, raw.page ?? null) : null,
      text: raw.text ?? null,
      note: raw.note ?? null,
    };

    switch (kind) {
      case OperationKind.PROGRESS_SET:
        this.requireInteger(normalized.baseRevision, 'baseRevision', 0);
        this.requireInteger(normalized.currentPage, 'currentPage', 1);
        if (normalized.scrollY !== null && (!Number.isFinite(normalized.scrollY) || normalized.scrollY < 0)) {
          throw new BadRequestException('scrollY must be a finite nonnegative number');
        }
        break;
      case OperationKind.BOOKMARK_ADD:
      case OperationKind.ANNOTATION_CREATE: {
        this.requireUuid(normalized.clientEntityId, 'clientEntityId');
        this.requireInteger(normalized.page, 'page', 1);
        if (kind === OperationKind.ANNOTATION_CREATE) {
          this.requireNonEmpty(normalized.text, 'text');
          if (normalized.anchor === null) throw new BadRequestException('anchor is required for ANNOTATION_CREATE');
        } else if (normalized.anchor) {
          this.validateAnchor(normalized.anchor, normalized.page);
        }
        break;
      }
      case OperationKind.BOOKMARK_REMOVE:
      case OperationKind.ANNOTATION_DELETE:
        this.requireId(normalized.entityId, 'entityId');
        this.requireInteger(normalized.baseRevision, 'baseRevision', 1);
        break;
      case OperationKind.ANNOTATION_UPDATE:
        this.requireId(normalized.entityId, 'entityId');
        if (normalized.targetKind !== OperationTargetKind.ANNOTATION && normalized.targetKind !== OperationTargetKind.CONFLICT_COPY) {
          throw new BadRequestException('targetKind must be ANNOTATION or CONFLICT_COPY for ANNOTATION_UPDATE');
        }
        this.requireInteger(normalized.baseRevision, 'baseRevision', 1);
        this.requireInteger(normalized.page, 'page', 1);
        this.requireNonEmpty(normalized.text, 'text');
        if (normalized.anchor === null) throw new BadRequestException('anchor is required for ANNOTATION_UPDATE');
        break;
      default:
        throw new BadRequestException('Unsupported operation kind');
    }

    return normalized;
  }

  private validateAnchor(anchor: { version: number; page: number; startOffset: number; endOffset: number }, page: number | null): NormalizedAnchor {
    if (anchor.version !== 1) throw new BadRequestException('anchor.version must be 1');
    this.requireInteger(anchor.page, 'anchor.page', 1);
    this.requireInteger(anchor.startOffset, 'anchor.startOffset', 0);
    if (!Number.isInteger(anchor.endOffset) || anchor.endOffset <= anchor.startOffset) {
      throw new BadRequestException('anchor.endOffset must be greater than startOffset');
    }
    if (page !== null && anchor.page !== page) {
      throw new BadRequestException('anchor.page must equal the operation page');
    }
    return { version: 1, page: anchor.page, startOffset: anchor.startOffset, endOffset: anchor.endOffset };
  }

  private requireInteger(value: unknown, name: string, min: number): void {
    if (!Number.isInteger(value) || (value as number) < min) {
      throw new BadRequestException(`${name} must be an integer >= ${min}`);
    }
  }

  private requireUuid(value: string | null, name: string): void {
    if (!value || !UUID_PATTERN.test(value)) throw new BadRequestException(`${name} must be a UUID`);
  }

  private requireId(value: string | null, name: string): void {
    if (!value) throw new BadRequestException(`${name} is required`);
  }

  private requireNonEmpty(value: string | null, name: string): void {
    if (!value || value.trim().length === 0) throw new BadRequestException(`${name} must be a non-empty string`);
  }
}

interface ConflictFields {
  page: number | null;
  text: string | null;
  note: string | null;
  color: string | null;
  anchor: NormalizedAnchor | null;
}
