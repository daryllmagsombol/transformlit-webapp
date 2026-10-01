import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BooksService } from './books.service.js';
import { UpgradeRequiredError } from './reader-mutation.errors.js';
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

@Injectable()
export class ReaderMutationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
  ) {}

  /**
   * Legacy reader writes can never carry a trustworthy revision/anchor/version,
   * so they are rejected instead of being guessed onto current content. This is
   * the single choke point routed through by the legacy BooksService methods;
   * it never mutates and never records a receipt.
   */
  rejectLegacyMutation(kind: string): never {
    throw new UpgradeRequiredError(kind);
  }

  /** Replay-safe entry point for every queued reader operation. */
  async applyOperation(subject: string, rawInput: ReaderOperationInput): Promise<ReaderOperationOutcome> {
    const input = this.validateOperation(rawInput);
    const payloadHash = this.hashPayload(input);

    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.readerOperationReceipt.findUnique({
        where: { subject_operationId: { subject, operationId: input.operationId } },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash) {
          throw new BadRequestException('operationId was already used with a different payload');
        }
        return { operationId: input.operationId, result: prior.result as OperationResultPayload };
      }

      const access = await this.resolveAccess(tx, input.bookId, subject);
      if (!access.allowed) {
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
      // Only applied/conflict outcomes are durable: access/version outcomes are
      // terminal only until state changes, so they must be re-evaluated on a
      // replay rather than frozen by a receipt. The mutation, any conflict copy,
      // and the receipt commit in this one transaction.
      if (result.kind === 'APPLIED' || result.kind === 'CONFLICT') {
        await this.recordReceipt(tx, receiptId, subject, input.operationId, payloadHash, result);
      }
      return { operationId: input.operationId, result };
    });
  }

  private async resolveAccess(
    tx: Prisma.TransactionClient,
    bookId: string,
    subject: string,
  ): Promise<{ allowed: boolean; reason: string; supportedContentVersions: number[] }> {
    const book = await tx.book.findUnique({ where: { id: bookId } });
    if (!book || book.deletedAt) return { allowed: false, reason: 'Book not available', supportedContentVersions: [] };
    const allowed = await this.books.canRead(book, subject);
    if (!allowed) return { allowed: false, reason: 'You do not have access to this book', supportedContentVersions: [] };

    const versions = await tx.bookContentVersion.findMany({
      where: { bookId },
      select: { contentVersion: true },
    });
    const supported = new Set<number>(versions.map((row) => row.contentVersion));
    supported.add(book.contentVersion);
    return { allowed: true, reason: '', supportedContentVersions: [...supported].sort((a, b) => a - b) };
  }

  private async recordReceipt(
    tx: Prisma.TransactionClient,
    receiptId: string,
    subject: string,
    operationId: string,
    payloadHash: string,
    result: OperationResultPayload,
  ): Promise<string> {
    try {
      const receipt = await tx.readerOperationReceipt.create({
        data: { id: receiptId, subject, operationId, payloadHash, result: result as unknown as Prisma.InputJsonValue },
      });
      return receipt.id;
    } catch (error) {
      // A concurrent identical operation won the unique insert; return its result.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await tx.readerOperationReceipt.findUnique({
          where: { subject_operationId: { subject, operationId } },
        });
        if (existing && existing.payloadHash !== payloadHash) {
          throw new BadRequestException('operationId was already used with a different payload');
        }
        if (existing) return existing.id;
      }
      throw error;
    }
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
    const existing = await tx.bookProgress.findUnique({
      where: { userId_bookId: { userId: subject, bookId: input.bookId } },
    });
    const baseRevision = input.baseRevision as number;
    const currentRevision = existing?.revision ?? 0;

    if (baseRevision !== currentRevision) {
      return this.conflict(
        subject,
        input.bookId,
        currentRevision,
        existing ? this.progressValue(existing) : this.emptyProgressValue(input),
        null,
      );
    }

    const updated = existing
      ? await tx.bookProgress.update({
          where: { userId_bookId: { userId: subject, bookId: input.bookId } },
          data: {
            currentPage: input.currentPage as number,
            scrollY: input.scrollY,
            lastReadAt: new Date(),
            revision: currentRevision + 1,
          },
        })
      : await tx.bookProgress.create({
          data: {
            userId: subject,
            bookId: input.bookId,
            currentPage: input.currentPage as number,
            scrollY: input.scrollY,
            revision: 1,
          },
        });

    return { kind: 'APPLIED', entityId: updated.id, revision: updated.revision, receiptId };
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
    if (existing && existing.deletedAt) {
      // A tombstoned identity can never be resurrected by a delayed add/retry.
      return this.conflict(
        subject,
        input.bookId,
        existing.revision,
        this.bookmarkValue(existing),
        null,
      );
    }
    if (existing) {
      return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
    }

    const created = await tx.bookmark.create({
      data: {
        userId: subject,
        bookId: input.bookId,
        clientEntityId,
        page: input.page as number,
        label: input.label,
        color: input.color,
        anchor: (input.anchor as unknown as Prisma.InputJsonValue) ?? undefined,
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
    const existing = await tx.bookmark.findFirst({ where: { id: entityId, userId: subject } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Bookmark not found for this account' };
    }
    const baseRevision = input.baseRevision as number;
    if (existing.deletedAt) {
      return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
    }
    if (existing.revision !== baseRevision) {
      return this.conflict(subject, input.bookId, existing.revision, this.bookmarkValue(existing), null);
    }

    const updated = await tx.bookmark.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), revision: existing.revision + 1 },
    });
    await this.upsertTombstone(tx, subject, existing.id, 'BOOKMARK', updated.revision);
    return { kind: 'APPLIED', entityId: updated.id, revision: updated.revision, receiptId };
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
    if (existing && existing.deletedAt) {
      return this.conflict(subject, input.bookId, existing.revision, this.highlightValue(existing), null);
    }
    if (existing) {
      return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
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
        anchor: input.anchor as unknown as Prisma.InputJsonValue,
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
    const existing = await tx.highlight.findFirst({ where: { id: entityId, userId: subject } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Annotation not found for this account' };
    }
    const baseRevision = input.baseRevision as number;

    if (existing.deletedAt) {
      // Edit-after-delete: keep the deletion history AND the attempted edit.
      const copy = await this.createConflictCopy(tx, subject, input, entityId, ConflictReason.DELETE_VS_EDIT);
      return this.conflict(subject, input.bookId, existing.revision, this.highlightValue(existing), copy);
    }
    if (existing.revision !== baseRevision) {
      // Stale edit: preserve server state and the offline edit as a conflict copy.
      const copy = await this.createConflictCopy(tx, subject, input, entityId, ConflictReason.STALE_REVISION);
      return this.conflict(subject, input.bookId, existing.revision, this.highlightValue(existing), copy);
    }

    const updated = await tx.highlight.update({
      where: { id: existing.id },
      data: {
        page: input.page as number,
        text: input.text as string,
        note: input.note,
        color: input.color,
        anchor: input.anchor as unknown as Prisma.InputJsonValue,
        revision: existing.revision + 1,
      },
    });
    return { kind: 'APPLIED', entityId: updated.id, revision: updated.revision, receiptId };
  }

  private async updateConflictCopy(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const entityId = input.entityId as string;
    const existing = await tx.conflictCopy.findFirst({ where: { id: entityId, subject } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Conflict copy not found for this account' };
    }
    const baseRevision = input.baseRevision as number;
    if (existing.revision !== baseRevision) {
      const copy = await this.createConflictCopy(tx, subject, input, existing.sourceEntityId ?? entityId, ConflictReason.STALE_REVISION);
      return this.conflict(subject, input.bookId, existing.revision, this.conflictCopyValue(existing), copy);
    }

    const updated = await tx.conflictCopy.update({
      where: { id: existing.id },
      data: {
        page: input.page as number,
        text: input.text as string,
        note: input.note,
        color: input.color,
        anchor: input.anchor as unknown as Prisma.InputJsonValue,
        revision: existing.revision + 1,
      },
    });
    return { kind: 'APPLIED', entityId: updated.id, revision: updated.revision, receiptId };
  }

  private async applyAnnotationDelete(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    receiptId: string,
  ): Promise<OperationResultPayload> {
    const entityId = input.entityId as string;
    const existing = await tx.highlight.findFirst({ where: { id: entityId, userId: subject } });
    if (!existing) {
      return { kind: 'ACCESS_DENIED', resourceId: entityId, reason: 'Annotation not found for this account' };
    }
    const baseRevision = input.baseRevision as number;
    if (existing.deletedAt) {
      return { kind: 'APPLIED', entityId: existing.id, revision: existing.revision, receiptId };
    }
    if (existing.revision !== baseRevision) {
      // Stale delete-after-edit: keep the newer edit and record the delete intent.
      const copy = await this.createConflictCopy(tx, subject, input, entityId, ConflictReason.DELETE_VS_EDIT);
      return this.conflict(subject, input.bookId, existing.revision, this.highlightValue(existing), copy);
    }

    const updated = await tx.highlight.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), revision: existing.revision + 1 },
    });
    await this.upsertTombstone(tx, subject, existing.id, 'ANNOTATION', updated.revision);
    return { kind: 'APPLIED', entityId: updated.id, revision: updated.revision, receiptId };
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

  private async createConflictCopy(
    tx: Prisma.TransactionClient,
    subject: string,
    input: NormalizedOperation,
    sourceEntityId: string,
    reason: ConflictReason,
  ): Promise<Record<string, unknown>> {
    const copy = await tx.conflictCopy.create({
      data: {
        subject,
        operationId: input.operationId,
        sourceEntityId,
        bookId: input.bookId,
        contentVersion: input.contentVersion,
        page: (input.page ?? 1) as number,
        text: (input.text ?? '') as string,
        note: input.note,
        color: input.color,
        anchor: (input.anchor as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        revision: 1,
        reason,
      },
    });
    return this.conflictCopyValue(copy);
  }

  private conflict(
    _subject: string,
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
      clientEntityId: row.clientEntityId,
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
      clientEntityId: row.clientEntityId,
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
   * must be absent, and every listed field must be present (nullable ones may
   * be null). UUID/ID formats, positive integers, finite numbers, non-empty
   * strings and the anchor rules are all checked before anything is applied.
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

    this.assertNullableShape(normalized);

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

  private assertNullableShape(op: NormalizedOperation): void {
    const mustBeNull: Array<[unknown, string]> = [
      [op.entityId, 'entityId'],
      [op.clientEntityId, 'clientEntityId'],
      [op.targetKind, 'targetKind'],
      [op.baseRevision, 'baseRevision'],
      [op.currentPage, 'currentPage'],
      [op.scrollY, 'scrollY'],
      [op.page, 'page'],
      [op.label, 'label'],
      [op.color, 'color'],
      [op.anchor, 'anchor'],
      [op.text, 'text'],
      [op.note, 'note'],
    ];
    for (const [value, name] of mustBeNull) {
      if (value === undefined) throw new BadRequestException(`Field "${name}" must not be undefined`);
    }
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
