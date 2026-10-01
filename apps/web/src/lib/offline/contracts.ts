// Domain contracts for the offline IndexedDB store.
//
// One versioned database carries every account-private and lifecycle record.
// Private records are namespaced by an immutable account `subject`; access is
// fenced by the lifecycle `epoch` captured when the record was created.
//
// These types are intentionally transport-agnostic so the API contract in
// docs/superpowers/specs/2026-10-01-pwa-contracts.md can be mirrored locally
// without importing server code.

export const OFFLINE_DB_NAME = 'transformlit-offline';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_SCHEMA_VERSION = 1;

// ── Lifecycle ────────────────────────────────────────────────────────────

export type LifecycleState =
  | 'SIGNED_OUT'
  | 'ACTIVE'
  | 'OFFLINE_ESTABLISHED'
  | 'SYNCING'
  | 'AUTH_REQUIRED'
  | 'SIGN_OUT_PENDING'
  | 'DEFERRED_LOGOUT';

/** Stable, account-private owner + fencing epoch. `subject` is immutable. */
export interface LifecycleStateRecord {
  id: 'lifecycle';
  state: LifecycleState;
  subject: string | null;
  epoch: number;
  updatedAt: number;
}

export type BarrierReason = 'SIGN_OUT' | 'ACCOUNT_SWITCH';

/** Durable gate written before destructive cleanup or account activation. */
export interface LifecycleBarrierRecord {
  id: 'lifecycle-barrier';
  subject: string;
  epoch: number;
  reason: BarrierReason;
  createdAt: number;
}

/** Offline logout could not invalidate the remote session; blocks activation. */
export interface DeferredLogoutRecord {
  id: 'deferred-logout';
  subject: string;
  epoch: number;
  createdAt: number;
}

export interface LifecycleRecord extends LifecycleStateRecord {
  ownerId: string;
}

export interface AccountOwner {
  subject: string;
  epoch: number;
}

/** Display-only auth identity. Never authorizes a private write on its own. */
export interface AuthDisplayState {
  subject: string;
  displayName: string | null;
}

/** Portable, fencing-token lease. Web Locks may enhance; this is authority. */
export interface LeaseRecord {
  id: string;
  subject: string;
  ownerId: string;
  fencingToken: number;
  acquiredAt: number;
  expiresAt: number;
}

// ── Downloads and content ────────────────────────────────────────────────

export type DownloadKind = 'BIBLE_CHAPTER' | 'BOOK';
export type DownloadStatus = 'STAGING' | 'READY' | 'FAILED';

export interface TocEntry {
  id: string;
  title: string;
  pageNumber: number;
  order: number;
}

export interface PageEntry {
  pageNumber: number;
  imageAssetId: string;
  textLayerAssetId: string;
}

export interface AssetEntry {
  assetId: string;
  kind: 'COVER' | 'PAGE_IMAGE' | 'TEXT_LAYER';
  pageNumber: number | null;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

/** Active/staged manifest for one downloaded book or Bible chapter. */
export interface DownloadManifestRecord {
  id: string;
  subject: string;
  kind: DownloadKind;
  contentId: string;
  contentVersion: number;
  status: DownloadStatus;
  itemCount: number;
  stagedAt: number;
  updatedAt: number;
}

export interface BookVersionRecord {
  id: string;
  subject: string;
  bookId: string;
  contentVersion: number;
  status: 'STAGED' | 'READY';
  title: string;
  author: string | null;
  description: string | null;
  coverAssetId: string | null;
  totalPages: number;
  toc: TocEntry[];
  createdAt: number;
}

export interface BookPageRecord {
  id: string;
  subject: string;
  bookId: string;
  contentVersion: number;
  pageNumber: number;
  imageAssetId: string;
  textLayerAssetId: string;
  image: Blob | null;
  text: string | null;
  textItems: unknown | null;
  verified: boolean;
}

export interface BibleChapterRecord {
  id: string;
  subject: string;
  translation: string;
  book: string;
  chapter: number;
  contentVersion: number;
  text: string;
  payload: unknown;
  downloadedAt: number;
}

// ── Reader records ───────────────────────────────────────────────────────

export type OperationKind =
  | 'PROGRESS_SET'
  | 'BOOKMARK_ADD'
  | 'BOOKMARK_REMOVE'
  | 'ANNOTATION_CREATE'
  | 'ANNOTATION_UPDATE'
  | 'ANNOTATION_DELETE';

export interface ProgressRecord {
  id: string;
  subject: string;
  bookId: string;
  contentVersion: number;
  currentPage: number;
  scrollY: number | null;
  revision: number;
  lastReadAt: number;
}

export interface BookmarkRecord {
  id: string;
  subject: string;
  clientEntityId: string;
  bookId: string;
  contentVersion: number;
  page: number;
  label: string | null;
  color: string | null;
  anchor: unknown | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface HighlightRecord {
  id: string;
  subject: string;
  clientEntityId: string;
  bookId: string;
  contentVersion: number;
  page: number;
  text: string;
  note: string | null;
  color: string | null;
  anchor: unknown;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface TombstoneRecord {
  id: string;
  subject: string;
  entityId: string;
  kind: 'BOOKMARK' | 'ANNOTATION';
  revision: number;
  deletedAt: number;
}

export type ConflictReason = 'STALE_REVISION' | 'DELETE_VS_EDIT';

export interface ConflictCopyRecord {
  id: string;
  subject: string;
  operationId: string;
  sourceEntityId: string;
  bookId: string;
  contentVersion: number;
  page: number;
  text: string;
  note: string | null;
  color: string | null;
  anchor: unknown;
  revision: number;
  reason: ConflictReason;
  createdAt: number;
}

// ── Outbox ───────────────────────────────────────────────────────────────

/**
 * A queued reader mutation. `entityKey` orders operations for one entity so a
 * dependency (an edit after an in-flight create) waits for its predecessor.
 * Bible navigation is preference-only and never enters the outbox.
 */
export interface OutboxOperation {
  id: string;
  subject: string;
  operationId: string;
  entityKey: string;
  bookId: string;
  contentVersion: number;
  kind: OperationKind;
  baseRevision: number | null;
  payload: unknown;
  seq: number;
  createdAt: number;
}

export interface OutboxReceiptRecord {
  id: string;
  subject: string;
  operationId: string;
  entityId: string | null;
  revision: number | null;
  resultKind: 'APPLIED' | 'CONFLICT' | 'INCOMPATIBLE_VERSION' | 'ACCESS_DENIED';
  acknowledgedAt: number;
}

// ── Errors ───────────────────────────────────────────────────────────────

export class OfflineStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineStorageError';
  }
}

export class SubjectMismatchError extends OfflineStorageError {
  constructor(message = 'Operation subject does not match the established account owner') {
    super(message);
    this.name = 'SubjectMismatchError';
  }
}

export class StaleEpochError extends OfflineStorageError {
  constructor(message = 'Operation was fenced by a newer lifecycle epoch') {
    super(message);
    this.name = 'StaleEpochError';
  }
}

export class StorageUnavailableError extends OfflineStorageError {
  constructor(message = 'IndexedDB is unavailable in this environment') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export class SchemaVersionError extends OfflineStorageError {
  constructor(message = 'Unsupported offline schema version') {
    super(message);
    this.name = 'SchemaVersionError';
  }
}

export class QuotaExceededError extends OfflineStorageError {
  constructor(message = 'Browser storage quota exceeded') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class TransactionAbortedError extends OfflineStorageError {
  constructor(message = 'IndexedDB transaction aborted before commit') {
    super(message);
    this.name = 'TransactionAbortedError';
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────

const KEY_SEPARATOR = '\u0000';

/** Builds an account-namespaced key. Every private key includes its subject. */
export function qualifyKey(subject: string, ...parts: Array<string | number>): string {
  return [subject, ...parts].join(KEY_SEPARATOR);
}

export function bookKey(subject: string, bookId: string): string {
  return qualifyKey(subject, 'book', bookId);
}

export function bibleChapterKey(
  subject: string,
  translation: string,
  book: string,
  chapter: number,
): string {
  return qualifyKey(subject, 'bible', translation, book, chapter);
}

export function assertSubject(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new SubjectMismatchError(`Expected subject ${expected} but received ${actual}`);
  }
}

export function isStaleEpoch(ownerEpoch: number, requestedEpoch: number): boolean {
  return requestedEpoch !== ownerEpoch;
}

/** Only 2xx-style failures retry; callers branch on the returned kind. */
export type FailureClassification = 'TRANSIENT' | 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'CONFLICT' | 'INCOMPATIBLE_VERSION';

export function classifyHttpFailure(status: number): FailureClassification {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'ACCESS_DENIED';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'INCOMPATIBLE_VERSION';
  return 'TRANSIENT';
}

/** Normalizes quota/abort/unavailable failures into typed storage errors. */
export function classifyStorageError(error: unknown): OfflineStorageError {
  if (error instanceof OfflineStorageError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new QuotaExceededError(error.message);
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new TransactionAbortedError(error.message);
  }
  if (error instanceof Error) return new OfflineStorageError(error.message);
  return new OfflineStorageError('Unknown offline storage failure');
}
