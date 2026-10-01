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

// ── Auth activation / fencing ────────────────────────────────────────────

/**
 * Result of classifying an auth-dependent failure. `AUTH_REQUIRED` is a
 * genuine credential rejection that pauses replay and requires same-subject
 * reauthentication; `TRANSIENT` is a network/5xx outage that pauses work but
 * must NOT clear local account data.
 */
export type AuthFailureClassification = 'TRANSIENT' | 'AUTH_REQUIRED';

/** A verified immutable subject bound to the lifecycle epoch it was issued in. */
export interface IdentityVerification {
  subject: string;
  epoch: number;
}

/** Outcome of attempting to establish or refresh local account ownership. */
export type InstallOutcome =
  | { status: 'INSTALLED'; owner: AccountOwner }
  | { status: 'STALE_EPOCH'; current: AccountOwner }
  | { status: 'SUBJECT_MISMATCH'; expected: string | null; received: string }
  | { status: 'BLOCKED'; reason: ExitBlockReason };

/** Whether private writes/replay are currently authorized. */
export type WritePermit =
  | { permitted: true; owner: AccountOwner }
  | { permitted: false; reason: 'NO_OWNER' | 'AUTH_REQUIRED' | 'BLOCKED' };

/** Whether replay may proceed under the current local ownership. */
export type ReplayIdentity =
  | { status: 'READY'; owner: AccountOwner }
  | { status: 'PAUSED'; reason: 'NO_OWNER' | 'AUTH_REQUIRED' | 'TRANSIENT' | 'BLOCKED' };

export type ExitBlockReason =
  | 'EXIT_NOT_IMPLEMENTED'
  | 'PENDING_WORK'
  | 'DEFERRED_LOGOUT'
  | 'REMOTE_INVALIDATION_REQUIRED';

/**
 * Fail-closed outcome for sign-out / account-switch. Task 13A only scaffolds
 * this: an unimplemented controlled exit must return `BLOCKED` rather than
 * clearing data or activating another subject.
 */
export type ExitDecision =
  | { status: 'PROCEED' }
  | { status: 'SYNC_REQUIRED'; reason: 'PENDING_WORK' }
  | { status: 'BLOCKED'; reason: ExitBlockReason };


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

/**
 * Durable download lifecycle. `STAGING`/`VERIFYING` are in-progress states,
 * `READY` is the only state that exposes content offline, and
 * `INTERRUPTED`/`FAILED`/`CANCELLED` are durable terminal-until-retried states.
 * An interrupted or failed replacement must never clear `activeVersion`.
 */
export type DownloadStatus =
  | 'STAGING'
  | 'VERIFYING'
  | 'READY'
  | 'INTERRUPTED'
  | 'FAILED'
  | 'CANCELLED';

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
  /** Application-relative, version-pinned URL emitted by the manifest. */
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Client mirror of the `200 OfflineBookManifest` wire contract. Assets are
 * fetched by id against the actual client API base; the manifest never leaks a
 * storage key.
 */
export interface OfflineBookManifest {
  contractVersion: number;
  bookId: string;
  contentVersion: number;
  title: string;
  author: string | null;
  description: string | null;
  coverAssetId: string | null;
  totalPages: number;
  toc: TocEntry[];
  pages: PageEntry[];
  assets: AssetEntry[];
}

/**
 * Durable status for one downloaded content id (a Bible book/chapter or a
 * Transformlit book). `contentVersion` is the version currently staged or
 * active; `activeVersion` is the last fully verified, openable version. They
 * differ exactly while a replacement transfer is incomplete, which is what
 * lets a failed replacement leave the previous complete version active.
 */
export interface DownloadManifestRecord {
  id: string;
  subject: string;
  kind: DownloadKind;
  contentId: string;
  contentVersion: number;
  /** Last ready/complete version exposed offline; null before the first publish. */
  activeVersion: number | null;
  status: DownloadStatus;
  itemCount: number;
  completedItems: number;
  /** Human-readable terminal error; null while healthy/in-progress. */
  error: string | null;
  stagedAt: number;
  updatedAt: number;
}

export interface BookVersionRecord {
  id: string;
  subject: string;
  bookId: string;
  contentVersion: number;
  status: 'STAGED' | 'READY';
  /** True only for the single version currently exposed offline. */
  active: boolean;
  title: string;
  author: string | null;
  description: string | null;
  coverAssetId: string | null;
  totalPages: number;
  toc: TocEntry[];
  /** Contract/server provenance for the pinned version. */
  provenance: string;
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

/**
 * A fully saved Bible chapter. `payload` holds the exact provider chapter
 * response (text verses + footnotes) and `bookMeta`/`translationMeta` carry the
 * metadata needed for offline navigation; `attribution`/`provenance` are
 * mandatory because the chapter may only be stored when its translation has
 * documented offline rights.
 */
export interface BibleChapterRecord {
  id: string;
  subject: string;
  translation: string;
  book: string;
  chapter: number;
  contentVersion: number;
  text: string;
  payload: unknown;
  translationMeta: { id: string; name: string; shortName: string } | null;
  bookMeta: { id: string; commonName: string; firstChapterNumber: number; lastChapterNumber: number } | null;
  chapterBounds: { firstChapter: number; lastChapter: number };
  provenance: string;
  attribution: string;
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

/** A downloaded asset failed length/digest/completeness verification. */
export class DownloadIntegrityError extends OfflineStorageError {
  constructor(message = 'Downloaded content failed integrity verification') {
    super(message);
    this.name = 'DownloadIntegrityError';
  }
}

/** The content's translation has no documented offline-storage rights. */
export class RightsBlockedError extends OfflineStorageError {
  constructor(message = 'This translation may not be stored offline') {
    super(message);
    this.name = 'RightsBlockedError';
  }
}

/** A download operation was rejected because no live account permits it. */
export class DownloadFencedError extends OfflineStorageError {
  constructor(message = 'Download rejected: account is not active') {
    super(message);
    this.name = 'DownloadFencedError';
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────

const KEY_SEPARATOR = '\u0000';

/** Key separator used by `qualifyKey`; exported so guards can verify prefixes. */
export const KEY_NAMESPACE_SEPARATOR = KEY_SEPARATOR;

/** Builds an account-namespaced key. Every private key includes its subject. */
export function qualifyKey(subject: string, ...parts: Array<string | number>): string {
  return [subject, ...parts].join(KEY_SEPARATOR);
}

/** True when `key` was built for `subject` by `qualifyKey`/`qualifyKey` helpers. */
export function keyBelongsToSubject(subject: string, key: string): boolean {
  return key.startsWith(`${subject}${KEY_SEPARATOR}`);
}

export function bookKey(subject: string, bookId: string): string {
  return qualifyKey(subject, 'book', bookId);
}

/** Key for one book's download manifest: unique per subject + book. */
export function bookDownloadKey(subject: string, bookId: string): string {
  return qualifyKey(subject, 'download', 'book', bookId);
}

/** Key for one immutable book-version descriptor. */
export function bookVersionKey(subject: string, bookId: string, contentVersion: number): string {
  return qualifyKey(subject, 'bookversion', bookId, contentVersion);
}

/** Key for one rendered page of a pinned book version. */
export function bookPageKey(subject: string, bookId: string, contentVersion: number, pageNumber: number): string {
  return qualifyKey(subject, 'bookpage', bookId, contentVersion, pageNumber);
}

/** Key for one Bible chapter's download manifest: subject + translation + book + chapter. */
export function bibleDownloadKey(subject: string, translation: string, book: string, chapter: number): string {
  return qualifyKey(subject, 'download', 'bible', translation, book, chapter);
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
