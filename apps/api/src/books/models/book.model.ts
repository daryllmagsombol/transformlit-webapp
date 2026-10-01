import {
  Field,
  ObjectType,
  InputType,
  ID,
  Int,
  Float,
  registerEnumType,
  createUnionType,
} from '@nestjs/graphql';
import { BookAccessLevel, BookFormat, BookStatus, ConversionStatus } from '@transformlit/shared';

registerEnumType(BookAccessLevel, { name: 'BookAccessLevel' });
registerEnumType(BookStatus, { name: 'BookStatus' });
registerEnumType(BookFormat, { name: 'BookFormat' });
registerEnumType(ConversionStatus, { name: 'ConversionStatus' });

@ObjectType()
export class BookTocEntry {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  depth: number;

  @Field(() => Int)
  order: number;
}

@ObjectType()
export class Book {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  author?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  coverUrl?: string;

  @Field({ nullable: true })
  price?: number;

  @Field({ nullable: true })
  currency?: string;

  @Field(() => BookAccessLevel)
  accessLevel: BookAccessLevel;

  @Field(() => BookStatus)
  status: BookStatus;

  @Field(() => BookFormat, { nullable: true })
  format?: BookFormat;

  @Field(() => ConversionStatus)
  conversionStatus: ConversionStatus;

  @Field(() => Int, { nullable: true })
  pageCount?: number;

  /**
   * Populated by the BooksResolver `toc` resolve field so it is available on
   * every Book path (`findById`, `listBooks`, `BookProgress.book`).
   */
  toc?: BookTocEntry[];

  @Field({ nullable: true })
  totalPages?: number;

  @Field({ nullable: true })
  publishedAt?: Date;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class BookProgress {
  @Field(() => ID)
  bookId: string;

  @Field(() => Book, { nullable: true })
  book?: Book;

  @Field()
  currentPage: number;

  @Field({ nullable: true })
  scrollY?: number;

  @Field({ nullable: true })
  completedAt?: Date;

  @Field()
  lastReadAt: Date;
}

@ObjectType()
export class Bookmark {
  @Field(() => ID)
  id: string;

  @Field()
  page: number;

  @Field({ nullable: true })
  label?: string;

  @Field({ nullable: true })
  color?: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class Highlight {
  @Field(() => ID)
  id: string;

  @Field()
  page: number;

  @Field()
  text: string;

  @Field({ nullable: true })
  note?: string;

  @Field({ nullable: true })
  color?: string;

  @Field()
  createdAt: Date;
}

@InputType()
export class UploadBookInput {
  @Field() title: string;

  @Field({ nullable: true })
  author?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => BookAccessLevel)
  accessLevel: BookAccessLevel;

  @Field({ nullable: true })
  price?: number;

  @Field({ nullable: true })
  currency?: string;
}

@InputType()
export class UpdateBookInput {
  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  author?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => BookAccessLevel, { nullable: true })
  accessLevel?: BookAccessLevel;

  @Field({ nullable: true })
  price?: number;

  @Field(() => BookStatus, { nullable: true })
  status?: BookStatus;
}

@InputType()
export class SaveProgressInput {
  @Field(() => ID) bookId: string;

  @Field() currentPage: number;

  @Field({ nullable: true })
  scrollY?: number;
}

@InputType()
export class AddBookmarkInput {
  @Field(() => ID) bookId: string;

  @Field() page: number;

  @Field({ nullable: true })
  label?: string;

  @Field({ nullable: true })
  color?: string;
}

@InputType()
export class AddHighlightInput {
  @Field(() => ID) bookId: string;

  @Field() page: number;

  @Field() text: string;

  @Field({ nullable: true })
  note?: string;

  @Field({ nullable: true })
  color?: string;
}

// ── Offline reader operation envelope (Task 8) ──────────────────────────────

export enum OperationKind {
  PROGRESS_SET = 'PROGRESS_SET',
  BOOKMARK_ADD = 'BOOKMARK_ADD',
  BOOKMARK_REMOVE = 'BOOKMARK_REMOVE',
  ANNOTATION_CREATE = 'ANNOTATION_CREATE',
  ANNOTATION_UPDATE = 'ANNOTATION_UPDATE',
  ANNOTATION_DELETE = 'ANNOTATION_DELETE',
}

export enum OperationTargetKind {
  ANNOTATION = 'ANNOTATION',
  CONFLICT_COPY = 'CONFLICT_COPY',
}

export enum OperationResultKind {
  APPLIED = 'APPLIED',
  CONFLICT = 'CONFLICT',
  INCOMPATIBLE_VERSION = 'INCOMPATIBLE_VERSION',
  ACCESS_DENIED = 'ACCESS_DENIED',
}

export enum ReaderEntityKind {
  PROGRESS = 'PROGRESS',
  BOOKMARK = 'BOOKMARK',
  ANNOTATION = 'ANNOTATION',
}

export enum ConflictReason {
  STALE_REVISION = 'STALE_REVISION',
  DELETE_VS_EDIT = 'DELETE_VS_EDIT',
}

registerEnumType(OperationKind, { name: 'OperationKind' });
registerEnumType(OperationTargetKind, { name: 'OperationTargetKind' });
registerEnumType(OperationResultKind, { name: 'OperationResultKind' });
registerEnumType(ReaderEntityKind, { name: 'ReaderEntityKind' });
registerEnumType(ConflictReason, { name: 'ConflictReason' });

@InputType()
export class PageTextAnchorV1Input {
  @Field(() => Int) version: number;

  @Field(() => Int) page: number;

  @Field(() => Int) startOffset: number;

  @Field(() => Int) endOffset: number;
}

@ObjectType()
export class PageTextAnchorV1 {
  @Field(() => Int) version: number;

  @Field(() => Int) page: number;

  @Field(() => Int) startOffset: number;

  @Field(() => Int) endOffset: number;
}

/**
 * Flattened typed operation envelope. Per-kind fields are required even though
 * represented as optional GraphQL fields; the server validates exact field
 * presence for the declared `kind` before applying anything.
 */
@InputType()
export class ReaderOperationInput {
  @Field() operationId: string;

  @Field(() => ID) bookId: string;

  @Field(() => Int) contentVersion: number;

  @Field(() => OperationKind) kind: OperationKind;

  @Field(() => ID, { nullable: true }) entityId?: string | null;

  @Field(() => String, { nullable: true }) clientEntityId?: string | null;

  @Field(() => OperationTargetKind, { nullable: true }) targetKind?: OperationTargetKind | null;

  @Field(() => Int, { nullable: true }) baseRevision?: number | null;

  @Field(() => Int, { nullable: true }) currentPage?: number | null;

  @Field(() => Float, { nullable: true }) scrollY?: number | null;

  @Field(() => Int, { nullable: true }) page?: number | null;

  @Field(() => String, { nullable: true }) label?: string | null;

  @Field(() => String, { nullable: true }) color?: string | null;

  @Field(() => PageTextAnchorV1Input, { nullable: true })
  anchor?: PageTextAnchorV1Input | null;

  @Field(() => String, { nullable: true }) text?: string | null;

  @Field(() => String, { nullable: true }) note?: string | null;
}

@ObjectType()
export class BookmarkRecord {
  @Field(() => ID) id: string;

  @Field() clientEntityId: string;

  @Field(() => ID) bookId: string;

  @Field(() => Int) page: number;

  @Field(() => String, { nullable: true }) label?: string | null;

  @Field(() => String, { nullable: true }) color?: string | null;

  @Field(() => PageTextAnchorV1, { nullable: true }) anchor?: PageTextAnchorV1 | null;

  @Field(() => Int) contentVersion: number;

  @Field(() => Int) revision: number;

  @Field(() => Date) createdAt: Date;

  @Field(() => Date, { nullable: true }) deletedAt?: Date | null;
}

@ObjectType()
export class HighlightRecord {
  @Field(() => ID) id: string;

  @Field() clientEntityId: string;

  @Field(() => ID) bookId: string;

  @Field(() => Int) page: number;

  @Field(() => String) text: string;

  @Field(() => String, { nullable: true }) note?: string | null;

  @Field(() => String, { nullable: true }) color?: string | null;

  @Field(() => PageTextAnchorV1) anchor: PageTextAnchorV1;

  @Field(() => Int) contentVersion: number;

  @Field(() => Int) revision: number;

  @Field(() => Date) createdAt: Date;

  @Field(() => Date) updatedAt: Date;

  @Field(() => Date, { nullable: true }) deletedAt?: Date | null;
}

@ObjectType()
export class ProgressRecord {
  @Field(() => ID) bookId: string;

  @Field(() => Int) currentPage: number;

  @Field(() => Float, { nullable: true }) scrollY?: number | null;

  @Field(() => Int) revision: number;

  @Field(() => Date) lastReadAt: Date;
}

@ObjectType()
export class ConflictCopy {
  @Field(() => ID) id: string;

  @Field() operationId: string;

  @Field(() => ID) sourceEntityId: string;

  @Field(() => ID) bookId: string;

  @Field(() => Int) contentVersion: number;

  @Field(() => Int) page: number;

  @Field(() => String) text: string;

  @Field(() => String, { nullable: true }) note?: string | null;

  @Field(() => String, { nullable: true }) color?: string | null;

  @Field(() => PageTextAnchorV1) anchor: PageTextAnchorV1;

  @Field(() => Int) revision: number;

  @Field(() => ConflictReason) reason: ConflictReason;

  @Field(() => Date) createdAt: Date;
}

@ObjectType()
export class ReaderTombstone {
  @Field(() => ID) entityId: string;

  @Field(() => ReaderEntityKind) kind: ReaderEntityKind;

  @Field(() => Int) revision: number;

  @Field() deletedAt: Date;
}

export const ReaderServerValue = createUnionType({
  name: 'ReaderServerValue',
  types: () => [BookmarkRecord, HighlightRecord, ConflictCopy, ProgressRecord] as const,
  resolveType: (value: { __typename?: string }) => value?.__typename,
});

@ObjectType()
export class ReaderOperationApplied {
  @Field(() => OperationResultKind) kind: OperationResultKind;

  @Field(() => ID) entityId: string;

  @Field(() => Int) revision: number;

  @Field(() => ID) receiptId: string;
}

@ObjectType()
export class ReaderOperationConflict {
  @Field(() => OperationResultKind) kind: OperationResultKind;

  @Field(() => ID) entityId: string;

  @Field(() => Int) serverRevision: number;

  @Field(() => ReaderServerValue) serverValue: typeof ReaderServerValue;

  @Field(() => ConflictCopy, { nullable: true }) conflictCopy?: ConflictCopy | null;
}

@ObjectType()
export class ReaderOperationIncompatibleVersion {
  @Field(() => OperationResultKind) kind: OperationResultKind;

  @Field(() => Int) requestedContentVersion: number;

  @Field(() => [Int]) supportedContentVersions: number[];
}

@ObjectType()
export class ReaderOperationAccessDenied {
  @Field(() => OperationResultKind) kind: OperationResultKind;

  @Field(() => ID) resourceId: string;

  @Field() reason: string;
}

export const ReaderOperationResultVariant = createUnionType({
  name: 'ReaderOperationResultVariant',
  types: () =>
    [
      ReaderOperationApplied,
      ReaderOperationConflict,
      ReaderOperationIncompatibleVersion,
      ReaderOperationAccessDenied,
    ] as const,
  resolveType: (value: { kind: OperationResultKind }) =>
    ({
      [OperationResultKind.APPLIED]: ReaderOperationApplied,
      [OperationResultKind.CONFLICT]: ReaderOperationConflict,
      [OperationResultKind.INCOMPATIBLE_VERSION]: ReaderOperationIncompatibleVersion,
      [OperationResultKind.ACCESS_DENIED]: ReaderOperationAccessDenied,
    })[value.kind],
});

@ObjectType()
export class ReaderOperationResult {
  @Field() operationId: string;

  @Field(() => ReaderOperationResultVariant) result: typeof ReaderOperationResultVariant;
}
