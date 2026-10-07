import { getAccessToken } from '../auth';
import { API_BASE } from '../constants';
import { BIBLE_API_BASE } from '../bible/config';
import { fetchChapterForOffline } from '../bible/api';
import { offlineAssetPath, offlineManifestPath } from '../reader/api';
import {
  type AccountOwner,
  type AssetEntry,
  type BibleChapterRecord,
  type BookPageRecord,
  type BookVersionRecord,
  type DownloadManifestRecord,
  DownloadFencedError,
  DownloadIntegrityError,
  OfflineStorageError,
  QuotaExceededError,
  RightsBlockedError,
  classifyStorageError,
  bookDownloadKey,
  bookPageKey,
  bookVersionKey,
  bibleChapterKey,
  bibleDownloadKey,
  qualifyKey,
} from './contracts';
import { OfflineDatabase } from './database';
import { referencedContentVersions } from './conflicts';
import { getStorageStatus, type StorageStatus } from './storage-status';
import {
  isOfflineDownloadAllowed,
  resolveOfflineRights,
  type TranslationOfflineRights,
} from '../bible/offline-rights';
import type { BibleChapter, FormattedText, InlineHeading, InlineLineBreak, VerseFootnoteReference } from '../bible/types';

/** Bearer-authenticated transcript failure with its HTTP status. */
export class DownloadHttpError extends OfflineStorageError {
  readonly status: number;

  constructor(status: number, message = `Download request failed with ${status}`) {
    super(message);
    this.name = 'DownloadHttpError';
    this.status = status;
  }
}

/** Progress snapshot surfaced to the download UI. */
export interface DownloadProgress {
  readonly kind: DownloadManifestRecord['kind'];
  readonly contentId: string;
  readonly contentVersion: number;
  readonly status: DownloadManifestRecord['status'];
  readonly completedItems: number;
  readonly itemCount: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type LifecycleLike = {
  writePermit(): { permitted: true; owner: AccountOwner } | { permitted: false; reason: string };
};

export interface DownloadManagerDeps {
  readonly database: OfflineDatabase;
  readonly lifecycle: LifecycleLike;
  readonly apiBase?: string;
  readonly bibleApiBase?: string;
  readonly fetchImpl?: FetchLike;
  readonly sha256?: (bytes: Uint8Array) => Promise<string>;
  readonly now?: () => number;
  readonly concurrency?: number;
  readonly getToken?: () => string | null;
  readonly onProgress?: (progress: DownloadProgress) => void;
  readonly fetchBibleChapter?: (translation: string, book: string, chapter: number, signal?: AbortSignal) => Promise<BibleChapter>;
}

interface BookRunContext {
  subject: string;
  epoch: number;
  bookId: string;
  manifest: OfflineBookManifestWire;
  versionKey: string;
  manifestKey: string;
}

/** The manifest shape as returned by `GET /api/books/{bookId}/offline-manifest`. */
interface OfflineBookManifestWire {
  contractVersion: number;
  bookId: string;
  contentVersion: number;
  title: string;
  author: string | null;
  description: string | null;
  coverAssetId: string | null;
  totalPages: number;
  toc: Array<{ id: string; title: string; pageNumber: number; order: number }>;
  pages: Array<{ pageNumber: number; imageAssetId: string; textLayerAssetId: string }>;
  assets: AssetEntry[];
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Removes every trailing `/`. Implemented as a linear scan (no regex) so the
 * operation cannot exhibit catastrophic backtracking (Sonar S5852 / ReDoS).
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && (value.codePointAt(end - 1) ?? 0) === 47 /* '/' */) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

const API_PREFIX = '/api';

/** Strips a leading `/api` so a base that already includes it never doubles up. */
export function stripApiPrefix(path: string): string {
  if (path === API_PREFIX) return '';
  if (path.startsWith(`${API_PREFIX}/`)) return path.slice(API_PREFIX.length);
  return path;
}

/**
 * Reconciles a manifest asset URL with the actual client API base. Manifests
 * may emit `/books/...` while the client base already ends in `/api`; the
 * resolved URL must always be `{apiBase}/books/{bookId}/content/{v}/assets/{id}`.
 */
export function resolveAssetUrl(apiBase: string, path: string): string {
  const base = trimTrailingSlashes(apiBase);
  const withoutOrigin = path.replace(/^https?:\/\/[^/]+/, '');
  const normalized = withoutOrigin.startsWith('/') ? withoutOrigin : `/${withoutOrigin}`;
  return `${base}${stripApiPrefix(normalized)}`;
}

async function defaultSha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Runs tasks with a fixed concurrency ceiling and drains in-flight work on error. */
async function runBounded<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  let failure: unknown = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length && failure === null) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(items[index]);
      } catch (error) {
        failure ??= error;
      }
    }
  });
  await Promise.all(runners);
  if (failure !== null) throw failure;
}

function assetFor(manifest: OfflineBookManifestWire, assetId: string): AssetEntry {
  const asset = manifest.assets.find((candidate) => candidate.assetId === assetId);
  if (!asset) throw new DownloadIntegrityError(`Manifest is missing asset ${assetId}`);
  return asset;
}

function validateManifest(manifest: OfflineBookManifestWire, requestedBookId: string): void {
  if (
    manifest.contractVersion !== 1 ||
    manifest.bookId !== requestedBookId ||
    !Number.isSafeInteger(manifest.contentVersion) || manifest.contentVersion < 1 ||
    !Number.isSafeInteger(manifest.totalPages) || manifest.totalPages < 1 ||
    !Array.isArray(manifest.pages) || manifest.pages.length !== manifest.totalPages ||
    !Array.isArray(manifest.toc) || !Array.isArray(manifest.assets)
  ) {
    throw new DownloadIntegrityError('Offline manifest is incomplete or does not match the requested book');
  }

  const assets = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));
  for (const page of manifest.pages) {
    const image = assets.get(page.imageAssetId);
    const text = assets.get(page.textLayerAssetId);
    if (
      !Number.isSafeInteger(page.pageNumber) || page.pageNumber < 1 || page.pageNumber > manifest.totalPages ||
      image?.kind !== 'PAGE_IMAGE' || image.pageNumber !== page.pageNumber ||
      text?.kind !== 'TEXT_LAYER' || text.pageNumber !== page.pageNumber
    ) {
      throw new DownloadIntegrityError(`Offline manifest page ${page.pageNumber} lacks its complete image/text pair`);
    }
  }
  for (const asset of manifest.assets) {
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new DownloadIntegrityError(`Offline manifest asset ${asset.assetId} has invalid integrity metadata`);
    }
  }
  if (manifest.coverAssetId && assets.get(manifest.coverAssetId)?.kind !== 'COVER') {
    throw new DownloadIntegrityError('Offline manifest cover asset is missing');
  }
  if (manifest.toc.some((entry) => !entry.id || !entry.title || entry.pageNumber < 1 || entry.pageNumber > manifest.totalPages)) {
    throw new DownloadIntegrityError('Offline manifest TOC is incomplete');
  }
}

async function shaOfBytes(bytes: Uint8Array, hasher: (value: Uint8Array) => Promise<string>): Promise<string> {
  return hasher(bytes);
}

/**
 * Terminal (non-retryable) versus retryable failure classification.
 *
 * - Access denied (401/403) and missing/unavailable content or version
 *   (404/410) are terminal: retrying cannot succeed until access or content
 *   state changes, so the UI must not offer an endless Retry.
 * - 408/429/5xx/network faults and quota/integrity failures are handled by the
 *   caller; quota and integrity are terminal, everything else stays
 *   `INTERRUPTED` (retryable).
 */
function isTerminalHttpStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

/** A specific, honest message for a terminal HTTP failure. */
function httpFailureMessage(error: DownloadHttpError): string {
  if (error.status === 401 || error.status === 403) {
    return 'You no longer have access to this content.';
  }
  return 'This content is no longer available to download.';
}

/**
 * Resolves the durable status + message for a failed transfer. Extracted so the
 * book and Bible paths share one classification and neither uses a nested
 * ternary (Sonar S6644).
 */
function classifyDownloadFailure(error: unknown): { status: DownloadManifestRecord['status']; message: string } {
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 'CANCELLED', message: error.message };
  }
  if (error instanceof DownloadHttpError) {
    if (isTerminalHttpStatus(error.status)) {
      return { status: 'FAILED', message: httpFailureMessage(error) };
    }
    return { status: 'INTERRUPTED', message: error.message };
  }
  const classified = classifyStorageError(error);
  const terminal =
    classified instanceof QuotaExceededError ||
    error instanceof DownloadIntegrityError ||
    classified.message.startsWith('INSUFFICIENT_SPACE:');
  if (terminal) return { status: 'FAILED', message: classified.message };
  return { status: 'INTERRUPTED', message: classified.message };
}

export class DownloadManager {
  private readonly database: OfflineDatabase;
  private readonly lifecycle: LifecycleLike;
  private readonly apiBase: string;
  private readonly bibleApiBase: string;
  private readonly fetchImpl: FetchLike;
  private readonly sha256: (bytes: Uint8Array) => Promise<string>;
  private readonly now: () => number;
  private readonly concurrency: number;
  private readonly token: () => string | null;
  private readonly onProgress: (progress: DownloadProgress) => void;
  private readonly fetchBibleSource: (translation: string, book: string, chapter: number, signal?: AbortSignal) => Promise<BibleChapter>;
  private readonly listeners = new Set<(progress: DownloadProgress) => void>();
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(deps: DownloadManagerDeps) {
    this.database = deps.database;
    this.lifecycle = deps.lifecycle;
    this.apiBase = trimTrailingSlashes(deps.apiBase ?? API_BASE);
    this.bibleApiBase = trimTrailingSlashes(deps.bibleApiBase ?? BIBLE_API_BASE);
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sha256 = deps.sha256 ?? defaultSha256;
    this.now = deps.now ?? (() => Date.now());
    this.concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
    this.token = deps.getToken ?? getAccessToken;
    this.onProgress = deps.onProgress ?? (() => undefined);
    this.fetchBibleSource = deps.fetchBibleChapter ?? fetchChapterForOffline;
  }

  // ── Permit / fencing ──────────────────────────────────────────────────

  /** Fails closed unless a live account currently authorizes private writes. */
  private permitOwner(): AccountOwner {
    const permit = this.lifecycle.writePermit();
    if (!permit.permitted) {
      throw new DownloadFencedError(`Download rejected: ${permit.reason}`);
    }
    return permit.owner;
  }

  private assertPermit(owner: AccountOwner): void {
    const current = this.permitOwner();
    if (current.subject !== owner.subject || current.epoch !== owner.epoch) {
      throw new DownloadFencedError('Download rejected: account owner changed during transfer');
    }
  }

  private operationKey(subject: string, kind: DownloadManifestRecord['kind'], contentId: string): string {
    return `${subject}:${kind}:${contentId}`;
  }

  private assertNotAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
  }

  private async putRecord(owner: AccountOwner, store: string, record: unknown): Promise<void> {
    this.assertPermit(owner);
    await this.database.putDownloadRecord(owner.subject, owner.epoch, store, record);
  }

  private authHeaders(): Record<string, string> {
    const token = this.token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private emit(progress: DownloadProgress): void {
    this.onProgress(progress);
    for (const listener of this.listeners) listener(progress);
  }

  subscribe(listener: (progress: DownloadProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private manifestFor(
    owner: AccountOwner,
    partial: Omit<DownloadManifestRecord, 'subject' | 'updatedAt' | 'error'> & { error?: string | null },
  ): DownloadManifestRecord {
    return { ...partial, subject: owner.subject, updatedAt: this.now(), error: partial.error ?? null };
  }

  private emitProgress(manifest: DownloadManifestRecord): void {
    this.emit({
      kind: manifest.kind,
      contentId: manifest.contentId,
      contentVersion: manifest.contentVersion,
      status: manifest.status,
      completedItems: manifest.completedItems,
      itemCount: manifest.itemCount,
    });
  }

  // ── Book download ─────────────────────────────────────────────────────

  async startBookDownload(bookId: string, contentVersion?: number): Promise<DownloadManifestRecord> {
    return this.runBookOperation(bookId, contentVersion, false);
  }

  async retryBookDownload(bookId: string): Promise<DownloadManifestRecord> {
    return this.runBookOperation(bookId, undefined, true);
  }

  private async runBookOperation(bookId: string, version: number | undefined, retry: boolean): Promise<DownloadManifestRecord> {
    const owner = this.permitOwner();
    const key = this.operationKey(owner.subject, 'BOOK', bookId);
    const controller = new AbortController();
    this.activeControllers.set(key, controller);
    try {
      return await this.runBookDownload(bookId, version, retry, owner, controller.signal);
    } finally {
      this.activeControllers.delete(key);
    }
  }

  private async runBookDownload(
    bookId: string,
    requestedVersion: number | undefined,
    retry: boolean,
    owner: AccountOwner,
    signal: AbortSignal,
  ): Promise<DownloadManifestRecord> {
    const existing = retry
      ? await this.database.getDownloadManifest(owner.subject, bookDownloadKey(owner.subject, bookId))
      : null;
    const version = requestedVersion ?? existing?.contentVersion;
    let attemptedVersion = version;

    try {
      const manifest = await this.fetchManifest(bookId, version, signal);
      this.assertNotAborted(signal);
      attemptedVersion = manifest.contentVersion;
      const current = await this.database.getDownloadManifest(owner.subject, bookDownloadKey(owner.subject, bookId));
      if (current?.status === 'READY' && current.activeVersion === manifest.contentVersion) return current;
      return await this.stageBook(owner, bookId, manifest, signal);
    } catch (error) {
      await this.recordBookFailure(owner, bookId, existing, error, attemptedVersion);
      throw error;
    }
  }

  private async fetchManifest(bookId: string, contentVersion?: number, signal?: AbortSignal): Promise<OfflineBookManifestWire> {
    const response = await this.fetchImpl(`${this.apiBase}${offlineManifestPath(bookId, contentVersion)}`, {
      headers: this.authHeaders(),
      signal,
    });
    if (!response.ok) throw new DownloadHttpError(response.status);
    const manifest = (await response.json()) as OfflineBookManifestWire;
    validateManifest(manifest, bookId);
    return manifest;
  }

  private async stageBook(
    owner: AccountOwner,
    bookId: string,
    manifest: OfflineBookManifestWire,
    signal: AbortSignal,
  ): Promise<DownloadManifestRecord> {
    const storage = await this.estimateStorage(true);
    const estimatedBytes = manifest.assets.reduce((total, asset) => total + asset.byteLength, 0);
    if (storage.supported && storage.quota !== null && storage.usage !== null && estimatedBytes > storage.quota - storage.usage) {
      throw new OfflineStorageError('INSUFFICIENT_SPACE: not enough browser storage for this book');
    }
    const versionKey = bookVersionKey(owner.subject, bookId, manifest.contentVersion);
    const manifestKey = bookDownloadKey(owner.subject, bookId);
    const priorManifest = await this.database.getDownloadManifest(owner.subject, manifestKey);
    const activeVersion = priorManifest?.activeVersion ?? null;

    const version: BookVersionRecord = {
      id: versionKey,
      subject: owner.subject,
      bookId,
      contentVersion: manifest.contentVersion,
      status: 'STAGED',
      active: false,
      title: manifest.title,
      author: manifest.author,
      description: manifest.description,
      coverAssetId: manifest.coverAssetId,
      totalPages: manifest.totalPages,
      toc: manifest.toc,
      provenance: `offline-manifest:contract-${manifest.contractVersion}:content-${manifest.contentVersion}`,
      createdAt: this.now(),
    };

    const stagingManifest = this.buildManifest(owner, manifestKey, bookId, manifest, 'STAGING', activeVersion, 0);
    await this.putRecord(owner, 'bookVersions', version);
    await this.putRecord(owner, 'downloadManifests', stagingManifest);
    this.emitProgress(stagingManifest);

    const context: BookRunContext = { subject: owner.subject, epoch: owner.epoch, bookId, manifest, versionKey, manifestKey };
    const reused = await this.reuseVerifiedPages(context);
    let completed = reused.size;
    const pendingPages = manifest.pages.filter((page) => !reused.has(page.pageNumber));
    await runBounded(pendingPages, this.concurrency, async (page) => {
      this.assertNotAborted(signal);
      const record = await this.fetchPage(context, page, signal);
      this.assertNotAborted(signal);
      await this.putRecord(owner, 'bookPages', record);
      completed += 1;
      const withProgress = this.buildManifest(owner, manifestKey, bookId, manifest, 'STAGING', activeVersion, completed);
      await this.putRecord(owner, 'downloadManifests', withProgress);
      this.emitProgress(withProgress);
    });

    const verifying = this.buildManifest(owner, manifestKey, bookId, manifest, 'VERIFYING', activeVersion, completed);
    this.assertNotAborted(signal);
    await this.putRecord(owner, 'downloadManifests', verifying);
    this.emitProgress(verifying);

    await this.verifyCompleteBook(context);
    this.assertNotAborted(signal);
    return this.publishBook(context, manifest, version, activeVersion);
  }

  /** Re-validates already-staged pages by re-hashing their stored bytes. */
  private async reuseVerifiedPages(context: BookRunContext): Promise<Set<number>> {
    const stored = await this.database.getBookPages(context.subject, context.bookId, context.manifest.contentVersion);
    const verified = new Set<number>();
    for (const page of stored) {
      if (await this.pageIsValid(context, page)) verified.add(page.pageNumber);
    }
    return verified;
  }

  private async pageIsValid(context: BookRunContext, page: BookPageRecord): Promise<boolean> {
    const entry = context.manifest.pages.find((candidate) => candidate.pageNumber === page.pageNumber);
    if (!entry || !page.image || page.text === null) return false;
    const imageOk = await this.verifyBytes(
      new Uint8Array(await page.image.arrayBuffer()),
      assetFor(context.manifest, entry.imageAssetId),
    );
    const textOk = await this.verifyBytes(encodeText(page.text), assetFor(context.manifest, entry.textLayerAssetId));
    return imageOk && textOk;
  }

  private async verifyBytes(bytes: Uint8Array, asset: AssetEntry): Promise<boolean> {
    if (bytes.byteLength !== asset.byteLength) return false;
    return (await shaOfBytes(bytes, this.sha256)) === asset.sha256;
  }

  private async fetchPage(
    context: BookRunContext,
    page: OfflineBookManifestWire['pages'][number],
    signal: AbortSignal,
  ): Promise<BookPageRecord> {
    const imageAsset = assetFor(context.manifest, page.imageAssetId);
    const textAsset = assetFor(context.manifest, page.textLayerAssetId);
    const imageBytes = await this.fetchAssetBytes(context, imageAsset, signal);
    await this.assertBytes(imageBytes, imageAsset);
    const textBytes = await this.fetchAssetBytes(context, textAsset, signal);
    await this.assertBytes(textBytes, textAsset);
    const text = new TextDecoder().decode(textBytes);

    return {
      id: bookPageKey(context.subject, context.bookId, context.manifest.contentVersion, page.pageNumber),
      subject: context.subject,
      bookId: context.bookId,
      contentVersion: context.manifest.contentVersion,
      pageNumber: page.pageNumber,
      imageAssetId: page.imageAssetId,
      textLayerAssetId: page.textLayerAssetId,
      image: new Blob([imageBytes as unknown as BlobPart], { type: imageAsset.mediaType }),
      text,
      textItems: tryParseJson(text),
      verified: true,
    };
  }

  private async fetchAssetBytes(context: BookRunContext, asset: AssetEntry, signal: AbortSignal): Promise<Uint8Array> {
    const path = asset.url ?? offlineAssetPath(context.bookId, context.manifest.contentVersion, asset.assetId);
    const url = resolveAssetUrl(this.apiBase, path);
    const response = await this.fetchImpl(url, { headers: this.authHeaders(), signal });
    if (!response.ok) throw new DownloadHttpError(response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async assertBytes(bytes: Uint8Array, asset: AssetEntry): Promise<void> {
    if (!(await this.verifyBytes(bytes, asset))) {
      throw new DownloadIntegrityError(`Asset ${asset.assetId} failed length/digest verification`);
    }
  }

  /** Confirms every manifest page is present and complete before publishing. */
  private async verifyCompleteBook(context: BookRunContext): Promise<void> {
    const stored = await this.database.getBookPages(context.subject, context.bookId, context.manifest.contentVersion);
    const byPage = new Map(stored.map((page) => [page.pageNumber, page]));
    for (const entry of context.manifest.pages) {
      const page = byPage.get(entry.pageNumber);
      if (!page?.image || page.text === null || !(await this.pageIsValid(context, page))) {
        throw new DownloadIntegrityError(`Page ${entry.pageNumber} is incomplete or failed verification`);
      }
    }
  }

  private async publishBook(
    context: BookRunContext,
    manifest: OfflineBookManifestWire,
    version: BookVersionRecord,
    activeVersion: number | null,
  ): Promise<DownloadManifestRecord> {
    const ready: BookVersionRecord = { ...version, status: 'READY', active: true };
    const readyManifest = this.buildManifest(
      { subject: context.subject, epoch: context.epoch },
      context.manifestKey,
      context.bookId,
      manifest,
      'READY',
      manifest.contentVersion,
      manifest.pages.length,
    );
    // Atomic: publish readiness + active-version selection together. A quota
    // failure here aborts the transaction and leaves the previous version active.
    this.assertPermit({ subject: context.subject, epoch: context.epoch });
    await this.database.publishBookVersion(context.subject, context.epoch, ready, readyManifest);
    this.emitProgress(readyManifest);
    return readyManifest;
  }

  private buildManifest(
    owner: AccountOwner,
    id: string,
    contentId: string,
    manifest: OfflineBookManifestWire,
    status: DownloadManifestRecord['status'],
    activeVersion: number | null,
    completedItems: number,
  ): DownloadManifestRecord {
    return this.manifestFor(owner, {
      id,
      kind: 'BOOK',
      contentId,
      contentVersion: manifest.contentVersion,
      activeVersion,
      status,
      itemCount: manifest.pages.length,
      completedItems,
      stagedAt: this.now(),
    });
  }

  private async recordBookFailure(
    owner: AccountOwner,
    bookId: string,
    existing: DownloadManifestRecord | null,
    error: unknown,
    attemptedVersion: number | undefined,
  ): Promise<void> {
    const failure = classifyDownloadFailure(error);
    const current = await this.database
      .getDownloadManifest(owner.subject, bookDownloadKey(owner.subject, bookId))
      .catch(() => existing);
    const prior = current ?? existing;
    const manifest: DownloadManifestRecord = {
      id: bookDownloadKey(owner.subject, bookId),
      subject: owner.subject,
      kind: 'BOOK',
      contentId: bookId,
      contentVersion: attemptedVersion ?? prior?.contentVersion ?? 0,
      // The previous complete version stays active regardless of this failure.
      activeVersion: prior?.activeVersion ?? null,
      status: failure.status,
      itemCount: prior?.itemCount ?? 0,
      completedItems: prior?.completedItems ?? 0,
      error: failure.message,
      stagedAt: prior?.stagedAt ?? this.now(),
      updatedAt: this.now(),
    };
    try {
      await this.putRecord(owner, 'downloadManifests', manifest);
    } catch {
      // A fenced write is expected after sign-out; the failure must not mask
      // the original error or corrupt the previous ready version.
    }
    this.emitProgress(manifest);
  }

  // ── Bible chapter download ────────────────────────────────────────────

  /**
   * Resolves and enforces offline rights for a translation. Overridable in
   * tests via the instance seam so documented-rights paths can be exercised
   * without weakening the production default (unknown -> disabled).
   */
  protected rightsFor(translation: string): TranslationOfflineRights {
    const rights = resolveOfflineRights(translation);
    if (!isOfflineDownloadAllowed(rights)) {
      throw new RightsBlockedError(
        `Offline download is disabled for translation ${translation}: redistribution/offline-storage rights are not documented`,
      );
    }
    return rights;
  }

  async startBibleChapterDownload(
    translation: string,
    book: string,
    chapter: number,
  ): Promise<DownloadManifestRecord> {
    const owner = this.permitOwner();
    const key = this.operationKey(owner.subject, 'BIBLE_CHAPTER', `${translation}:${book}:${chapter}`);
    const controller = new AbortController();
    this.activeControllers.set(key, controller);
    try {
      return await this.runBibleChapterDownload(owner, translation, book, chapter, controller.signal);
    } finally {
      this.activeControllers.delete(key);
    }
  }

  private async runBibleChapterDownload(
    owner: AccountOwner,
    translation: string,
    book: string,
    chapter: number,
    signal: AbortSignal,
  ): Promise<DownloadManifestRecord> {
    // Rights gate runs before any network I/O: an undocumented translation is
    // disabled even if the provider advertises "free use".
    const rights = this.rightsFor(translation);
    const manifestKey = bibleDownloadKey(owner.subject, translation, book, chapter);
    const prior = await this.database.getDownloadManifest(owner.subject, manifestKey);
    let manifest: DownloadManifestRecord = {
      id: manifestKey,
      subject: owner.subject,
      kind: 'BIBLE_CHAPTER',
      contentId: `${translation}:${book}:${chapter}`,
      contentVersion: prior?.contentVersion ?? 1,
      activeVersion: prior?.activeVersion ?? null,
      status: 'STAGING',
      itemCount: 1,
      completedItems: 0,
      error: null,
      stagedAt: this.now(),
      updatedAt: this.now(),
    };
    await this.putRecord(owner, 'downloadManifests', manifest);
    this.emitProgress(manifest);

    try {
      const payload = await this.fetchBibleChapter(translation, book, chapter, signal);
      this.assertNotAborted(signal);
      this.validateBibleChapter(payload, translation, book, chapter);
      const record = this.buildChapterRecord(owner, translation, book, chapter, payload, rights.attribution);
      manifest = { ...manifest, status: 'VERIFYING', contentVersion: record.contentVersion, updatedAt: this.now() };
      this.assertNotAborted(signal);
      this.assertPermit(owner);
      await this.database.publishBibleChapter(owner.subject, owner.epoch, record, manifest);
      const stored = await this.database.getBibleChapter(owner.subject, translation, book, chapter);
      this.validateStoredBibleChapter(stored, translation, book, chapter);
      this.assertNotAborted(signal);
      manifest = { ...manifest, status: 'READY', activeVersion: record.contentVersion, completedItems: 1, updatedAt: this.now() };
      this.assertPermit(owner);
      await this.database.publishBibleChapter(owner.subject, owner.epoch, record, manifest);
      this.emitProgress(manifest);
      return manifest;
    } catch (error) {
      const current = await this.database.getDownloadManifest(owner.subject, manifestKey).catch(() => prior);
      const failure = classifyDownloadFailure(error);
      const failed: DownloadManifestRecord = {
        ...(current ?? manifest),
        status: failure.status,
        activeVersion: current?.activeVersion ?? prior?.activeVersion ?? null,
        error: failure.message,
        updatedAt: this.now(),
      };
      await this.putRecord(owner, 'downloadManifests', failed).catch(() => undefined);
      this.emitProgress(failed);
      throw error;
    }
  }

  private async fetchBibleChapter(
    translation: string,
    book: string,
    chapter: number,
    signal?: AbortSignal,
  ): Promise<BibleChapter> {
    return this.fetchBibleSource(translation, book, chapter, signal);
  }

  private validateBibleChapter(payload: BibleChapter, translation: string, book: string, chapter: number): void {
    if (
      payload.translation.id !== translation || payload.book.id !== book || payload.chapter.number !== chapter ||
      chapter < payload.book.firstChapterNumber || chapter > payload.book.lastChapterNumber ||
      !Array.isArray(payload.chapter.content) || !Array.isArray(payload.chapter.footnotes) ||
      payload.chapter.content.length === 0
    ) {
      throw new DownloadIntegrityError('Bible provider returned an incomplete or mismatched chapter');
    }
  }

  private validateStoredBibleChapter(
    stored: BibleChapterRecord | null,
    translation: string,
    book: string,
    chapter: number,
  ): void {
    if (stored?.translation !== translation || stored.book !== book || stored.chapter !== chapter) {
      throw new DownloadIntegrityError('Stored Bible chapter failed verification');
    }
    this.validateBibleChapter(stored.payload as BibleChapter, translation, book, chapter);
  }

  private buildChapterRecord(
    owner: AccountOwner,
    translation: string,
    book: string,
    chapter: number,
    payload: BibleChapter,
    attribution: string,
  ): BibleChapterRecord {
    return {
      id: bibleChapterKey(owner.subject, translation, book, chapter),
      subject: owner.subject,
      translation,
      book,
      chapter,
      contentVersion: 1,
      text: chapterText(payload),
      payload: offlineChapterPayload(payload),
      translationMeta: payload.translation ?? null,
      bookMeta: payload.book
        ? {
            id: payload.book.id,
            commonName: payload.book.commonName,
            firstChapterNumber: payload.book.firstChapterNumber,
            lastChapterNumber: payload.book.lastChapterNumber,
          }
        : null,
      chapterBounds: {
        firstChapter: payload.book?.firstChapterNumber ?? chapter,
        lastChapter: payload.book?.lastChapterNumber ?? chapter,
      },
      provenance: `${this.bibleApiBase}/${translation}/${book}/${chapter}.json`,
      attribution,
      downloadedAt: this.now(),
    };
  }

  // ── Status / retry / cancel / remove ──────────────────────────────────

  async getBookStatus(bookId: string): Promise<DownloadManifestRecord | null> {
    const owner = this.lifecycle.writePermit();
    if (!owner.permitted) return null;
    return this.database.getDownloadManifest(owner.owner.subject, bookDownloadKey(owner.owner.subject, bookId));
  }

  async getBibleChapterStatus(
    translation: string,
    book: string,
    chapter: number,
  ): Promise<DownloadManifestRecord | null> {
    const owner = this.lifecycle.writePermit();
    if (!owner.permitted) return null;
    return this.database.getDownloadManifest(
      owner.owner.subject,
      bibleDownloadKey(owner.owner.subject, translation, book, chapter),
    );
  }

  async retryBibleChapterDownload(
    translation: string,
    book: string,
    chapter: number,
  ): Promise<DownloadManifestRecord> {
    return this.startBibleChapterDownload(translation, book, chapter);
  }

  async cancelBookDownload(bookId: string): Promise<void> {
    const owner = this.permitOwner();
    this.activeControllers.get(this.operationKey(owner.subject, 'BOOK', bookId))?.abort();
    const manifestKey = bookDownloadKey(owner.subject, bookId);
    const manifest = await this.database.getDownloadManifest(owner.subject, manifestKey);
    if (manifest && manifest.status !== 'READY') {
      await this.putRecord(owner, 'downloadManifests', {
        ...manifest,
        status: 'CANCELLED',
        activeVersion: manifest.activeVersion,
        updatedAt: this.now(),
      });
    }
  }

  async cancelBibleChapterDownload(translation: string, book: string, chapter: number): Promise<void> {
    const owner = this.permitOwner();
    this.activeControllers.get(this.operationKey(owner.subject, 'BIBLE_CHAPTER', `${translation}:${book}:${chapter}`))?.abort();
    const id = bibleDownloadKey(owner.subject, translation, book, chapter);
    const manifest = await this.database.getDownloadManifest(owner.subject, id);
    if (!manifest || manifest.status === 'READY') return;
    await this.putRecord(owner, 'downloadManifests', {
      ...manifest,
      status: 'CANCELLED',
      updatedAt: this.now(),
    });
  }

  /**
   * Removes downloaded content only; reader records/outbox are never touched.
   * Versions still referenced by a saved annotation or a pending operation are
   * PINNED (retained) so an anchor is never reinterpreted against newer content.
   */
  async removeBookDownload(bookId: string): Promise<void> {
    const owner = this.permitOwner();
    await this.database.removeBookDownload(
      owner.subject,
      owner.epoch,
      bookId,
      bookDownloadKey(owner.subject, bookId),
      await this.referencedVersions(owner.subject, bookId),
    );
  }

  /** Content versions still referenced by saved records or pending operations. */
  async referencedVersions(subject: string, bookId: string): Promise<number[]> {
    const records = await this.database.getAllByIndex<{ contentVersion?: number }>(
      'readerRecords',
      'subjectBook',
      [subject, bookId],
    );
    const operations = await this.database.getAllByIndex<{ contentVersion?: number; bookId?: string }>(
      'outbox',
      'subject',
      subject,
    );
    return referencedContentVersions(
      records,
      operations.filter((operation) => operation.bookId === bookId),
    );
  }

  /** Removes one saved chapter; annotations and pending edits survive. */
  async removeBibleChapter(translation: string, book: string, chapter: number): Promise<void> {
    const owner = this.permitOwner();
    await this.database.removeBibleChapter(
      owner.subject,
      owner.epoch,
      translation,
      book,
      chapter,
      bibleDownloadKey(owner.subject, translation, book, chapter),
    );
  }

  async listDownloads(): Promise<DownloadManifestRecord[]> {
    const owner = this.lifecycle.writePermit();
    if (!owner.permitted) return [];
    return this.database.listDownloadManifests(owner.owner.subject);
  }

  /** Generic status lookup used by list/control components. */
  async status(kind: 'BOOK' | 'BIBLE_CHAPTER', contentId: string): Promise<DownloadManifestRecord | null> {
    const permit = this.lifecycle.writePermit();
    if (!permit.permitted) return null;
    const subject = permit.owner.subject;
    const id = kind === 'BOOK'
      ? bookDownloadKey(subject, contentId)
      : chapterManifestKey(subject, contentId);
    return this.database.getDownloadManifest(subject, id);
  }

  async retry(kind: 'BOOK' | 'BIBLE_CHAPTER', contentId: string): Promise<DownloadManifestRecord> {
    if (kind === 'BOOK') return this.retryBookDownload(contentId);
    const chapter = parseBibleContentId(contentId);
    return this.retryBibleChapterDownload(chapter.translation, chapter.book, chapter.chapter);
  }

  async cancel(kind: 'BOOK' | 'BIBLE_CHAPTER', contentId: string): Promise<void> {
    if (kind === 'BOOK') return this.cancelBookDownload(contentId);
    const chapter = parseBibleContentId(contentId);
    return this.cancelBibleChapterDownload(chapter.translation, chapter.book, chapter.chapter);
  }

  async remove(kind: 'BOOK' | 'BIBLE_CHAPTER', contentId: string): Promise<void> {
    if (kind === 'BOOK') return this.removeBookDownload(contentId);
    const chapter = parseBibleContentId(contentId);
    return this.removeBibleChapter(chapter.translation, chapter.book, chapter.chapter);
  }

  /** Online reader records/outbox count for one subject, used by safety checks. */
  async listReaderRecordCount(subject: string): Promise<number> {
    const records = await this.database.getAllByIndex<{ id: string }>('readerRecords', 'subject', subject);
    const outbox = await this.database.getAllByIndex<{ id: string }>('outbox', 'subject', subject);
    return records.length + outbox.length;
  }

  /** Reports persistent-storage support and usage/quota; never promises durability. */
  estimateStorage(persist = false): Promise<StorageStatus> {
    return getStorageStatus({ persist });
  }

  /** Account-namespaced key for a saved chapter, exposed for UI keys. */
  chapterKey(subject: string, translation: string, book: string, chapter: number): string {
    return qualifyKey(subject, 'download', 'bible', translation, book, chapter);
  }
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function chapterManifestKey(subject: string, contentId: string): string {
  const parsed = parseBibleContentId(contentId);
  return bibleDownloadKey(subject, parsed.translation, parsed.book, parsed.chapter);
}

function parseBibleContentId(contentId: string): { translation: string; book: string; chapter: number } {
  const parts = contentId.split(':');
  const chapterRaw = parts.pop();
  const book = parts.pop();
  const translation = parts.join(':');
  const chapter = Number(chapterRaw);
  if (!translation || !book || !Number.isSafeInteger(chapter) || chapter < 1) {
    throw new OfflineStorageError('Invalid Bible chapter content id');
  }
  return { translation, book, chapter };
}

function pushTextPieces(
  pieces: string[],
  content: readonly (string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference)[],
): void {
  for (const item of content) {
    if (typeof item === 'string') pieces.push(item);
    else if ('text' in item && typeof item.text === 'string') pieces.push(item.text);
    else if ('heading' in item && typeof item.heading === 'string') pieces.push(item.heading);
  }
}

function chapterText(payload: BibleChapter): string {
  const pieces: string[] = [];
  for (const section of payload.chapter.content) {
    if (section.type === 'verse') {
      pushTextPieces(pieces, section.content);
    } else if (section.type === 'heading') {
      pieces.push(...section.content);
    } else if (section.type === 'hebrew_subtitle') {
      pushTextPieces(pieces, section.content);
    }
  }
  for (const footnote of payload.chapter.footnotes) pieces.push(footnote.text);
  return pieces.join('\n');
}

function offlineChapterPayload(payload: BibleChapter): BibleChapter {
  return {
    translation: payload.translation,
    book: payload.book,
    thisChapterLink: payload.thisChapterLink,
    nextChapterApiLink: null,
    previousChapterApiLink: null,
    numberOfVerses: payload.numberOfVerses,
    chapter: payload.chapter,
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
