import {
  OfflineStorageError,
  bookDownloadKey,
  type AccountOwner,
  type BookPageRecord,
  type BookVersionRecord,
  type TocEntry,
} from '../offline/contracts';
import type { OfflineDatabase } from '../offline/database';
import { pageFrameUrl, type PdfPageText, type PdfTextItem } from './api';

/** Features that may be unavailable when reading from the local store. */
export interface ReaderCapabilities {
  readonly audio: boolean;
  readonly remoteSearch: boolean;
  readonly enrichment: boolean;
  readonly realtime: boolean;
  readonly navigation: boolean;
}

/** Conversion states reported by the book manifest. */
export type BookConversionStatus = 'NOT_APPLICABLE' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

/** Presentation metadata resolved by the repository before pages are opened. */
export interface BookMetadata {
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number;
  readonly contentVersion: number;
  readonly conversionStatus: BookConversionStatus;
  readonly toc: readonly TocEntry[];
}

/**
 * A resolved frame source. `network` frames are authenticated URLs owned by the
 * API; `local` frames are Blob URLs created from stored bytes. `dispose` is
 * idempotent and is the only place a Blob URL is revoked.
 */
export interface FrameHandle {
  readonly source: 'network' | 'local';
  readonly url: string;
  dispose(): void;
}

/** One openable page: its frame handle plus the optional selectable text layer. */
export interface ReaderPage {
  readonly pageNumber: number;
  readonly items: PdfTextItem[] | null;
  readonly frame: FrameHandle;
}

/** An opened book bound to one content source. */
export interface OpenedBook {
  readonly source: 'network' | 'local';
  readonly bookId: string;
  readonly contentVersion: number;
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number;
  readonly conversionStatus: BookConversionStatus;
  readonly toc: readonly TocEntry[];
  readonly capabilities: ReaderCapabilities;
  openPage(pageNumber: number): Promise<ReaderPage>;
}

export interface OpenBookOptions {
  /** When true, only the local store is consulted; no session/network request. */
  readonly localOnly?: boolean;
}

export interface BookRepositoryDeps {
  readonly database: OfflineDatabase;
  /** The locally established account owner; null means no private reads. */
  readonly getOwner: () => AccountOwner | null;
  /**
   * Online metadata source (version-pinned or current). Required only for the
   * network path; an offline-only repository (the hub) may omit it.
   */
  readonly fetchMetadata?: (bookId: string, contentVersion?: number) => Promise<BookMetadata>;
  /** Starts the network reading session; only called on the network path. */
  readonly openSession?: (bookId: string) => Promise<unknown>;
  readonly fetchText?: (bookId: string, page: number) => Promise<PdfPageText>;
  readonly frameUrl?: (bookId: string, page: number) => string;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export class BookNotDownloadedError extends OfflineStorageError {
  constructor(message = 'This book has not been downloaded for offline reading') {
    super(message);
    this.name = 'BookNotDownloadedError';
  }
}

export class BookNotReadyError extends OfflineStorageError {
  constructor(message = 'This book download is not ready to open') {
    super(message);
    this.name = 'BookNotReadyError';
  }
}

export class RequestedVersionUnavailableError extends OfflineStorageError {
  constructor(message = 'The requested content version is not available offline') {
    super(message);
    this.name = 'RequestedVersionUnavailableError';
  }
}

export class IncompleteBookError extends OfflineStorageError {
  constructor(message = 'The downloaded book is incomplete') {
    super(message);
    this.name = 'IncompleteBookError';
  }
}

const LOCAL_BOOK_CAPABILITIES: ReaderCapabilities = {
  audio: false,
  remoteSearch: false,
  enrichment: false,
  realtime: false,
  // Page turning is entirely local once a version is stored.
  navigation: true,
};

const NETWORK_CAPABILITIES: ReaderCapabilities = {
  audio: true,
  remoteSearch: true,
  enrichment: true,
  realtime: true,
  navigation: true,
};

function defaultCreateObjectUrl(blob: Blob): string {
  return globalThis.URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url: string): void {
  globalThis.URL.revokeObjectURL(url);
}

function createDisposableFrame(source: 'network' | 'local', url: string, revoke: () => void): FrameHandle {
  let disposed = false;
  return {
    source,
    url,
    dispose() {
      if (disposed) return;
      disposed = true;
      revoke();
    },
  };
}

/** Extracts the page text items from a stored record, tolerating legacy shapes. */
function itemsFromRecord(record: BookPageRecord): PdfTextItem[] | null {
  const parsed = record.textItems as { items?: PdfTextItem[] } | null;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  if (record.text) {
    try {
      const fallback = JSON.parse(record.text) as { items?: PdfTextItem[] };
      if (Array.isArray(fallback.items)) return fallback.items;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Application-level book reader. It resolves an opened book from either the
 * offline store (local, session-free) or the network, and encapsulates the
 * frame URL lifecycle so components never construct authenticated URLs or
 * branch on storage implementation.
 */
export class BookRepository {
  private readonly database: OfflineDatabase;
  private readonly getOwner: () => AccountOwner | null;
  private readonly fetchMetadata?: BookRepositoryDeps['fetchMetadata'];
  private readonly openSession?: BookRepositoryDeps['openSession'];
  private readonly fetchText?: BookRepositoryDeps['fetchText'];
  private readonly frameUrl: (bookId: string, page: number) => string;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;

  constructor(deps: BookRepositoryDeps) {
    this.database = deps.database;
    this.getOwner = deps.getOwner;
    this.fetchMetadata = deps.fetchMetadata;
    this.openSession = deps.openSession;
    this.fetchText = deps.fetchText;
    this.frameUrl = deps.frameUrl ?? pageFrameUrl;
    this.createObjectUrl = deps.createObjectUrl ?? defaultCreateObjectUrl;
    this.revokeObjectUrl = deps.revokeObjectUrl ?? defaultRevokeObjectUrl;
  }

  async open(bookId: string, requestedVersion?: number, options: OpenBookOptions = {}): Promise<OpenedBook> {
    if (options.localOnly) return this.openLocal(bookId, requestedVersion);
    return this.openNetwork(bookId, requestedVersion);
  }

  // ── Local (offline) path ──────────────────────────────────────────────

  private async openLocal(bookId: string, requestedVersion?: number): Promise<OpenedBook> {
    const owner = this.getOwner();
    if (!owner) throw new BookNotDownloadedError('No local account owns this download');

    const version = await this.resolveLocalVersion(owner.subject, bookId, requestedVersion);
    const pages = await this.database.getBookPages(owner.subject, bookId, version.contentVersion);
    if (!this.isComplete(version, pages)) {
      throw new IncompleteBookError(`Downloaded book ${bookId} v${version.contentVersion} is missing pages`);
    }

    const byPage = new Map(pages.map((page) => [page.pageNumber, page]));
    return {
      source: 'local',
      bookId,
      contentVersion: version.contentVersion,
      title: version.title,
      author: version.author,
      pageCount: version.totalPages,
      // A stored version is by definition fully converted and ready.
      conversionStatus: 'READY',
      toc: version.toc,
      capabilities: LOCAL_BOOK_CAPABILITIES,
      openPage: (pageNumber) => this.openLocalPage(byPage, pageNumber),
    };
  }

  private async resolveLocalVersion(
    subject: string,
    bookId: string,
    requestedVersion?: number,
  ): Promise<BookVersionRecord> {
    if (requestedVersion !== undefined) {
      const version = await this.database.getBookVersion(subject, bookId, requestedVersion);
      if (!version) throw new RequestedVersionUnavailableError(`Version ${requestedVersion} of ${bookId} is not stored`);
      if (version.status !== 'READY') throw new BookNotReadyError(`Version ${requestedVersion} of ${bookId} is not ready`);
      return version;
    }

    const active = await this.database.getActiveBookVersion(subject, bookId);
    if (active) return active;

    const manifest = await this.database.getDownloadManifest(subject, bookDownloadKey(subject, bookId));
    if (manifest) throw new BookNotReadyError(`Book ${bookId} is not ready to open`);
    throw new BookNotDownloadedError(`Book ${bookId} has no stored version`);
  }

  private isComplete(version: BookVersionRecord, pages: readonly BookPageRecord[]): boolean {
    if (pages.length < version.totalPages) return false;
    const present = new Set(pages.map((page) => page.pageNumber));
    for (let page = 1; page <= version.totalPages; page += 1) {
      if (!present.has(page)) return false;
    }
    return true;
  }

  private async openLocalPage(
    byPage: ReadonlyMap<number, BookPageRecord>,
    pageNumber: number,
  ): Promise<ReaderPage> {
    const record = byPage.get(pageNumber);
    if (!record?.image) {
      throw new IncompleteBookError(`Page ${pageNumber} is missing its stored image`);
    }
    const url = this.createObjectUrl(record.image);
    return {
      pageNumber,
      items: itemsFromRecord(record),
      frame: createDisposableFrame('local', url, () => this.revokeObjectUrl(url)),
    };
  }

  // ── Network path ──────────────────────────────────────────────────────

  private async openNetwork(bookId: string, requestedVersion?: number): Promise<OpenedBook> {
    if (!this.fetchMetadata || !this.openSession || !this.fetchText) {
      throw new OfflineStorageError('Network reading is not configured for this repository');
    }
    const metadata = await this.fetchMetadata(bookId, requestedVersion);
    await this.openSession(bookId);
    return {
      source: 'network',
      bookId,
      contentVersion: metadata.contentVersion,
      title: metadata.title,
      author: metadata.author,
      pageCount: metadata.pageCount,
      conversionStatus: metadata.conversionStatus,
      toc: metadata.toc,
      capabilities: NETWORK_CAPABILITIES,
      openPage: (pageNumber) => this.openNetworkPage(bookId, pageNumber),
    };
  }

  private async openNetworkPage(bookId: string, pageNumber: number): Promise<ReaderPage> {
    if (!this.fetchText || !this.openSession) {
      throw new OfflineStorageError('Network reading is not configured for this repository');
    }
    const url = this.frameUrl(bookId, pageNumber);
    const items = await this.fetchTextWithSessionRetry(bookId, pageNumber);
    return {
      pageNumber,
      items,
      frame: createDisposableFrame('network', url, () => undefined),
    };
  }

  /**
   * A cold deep-link load can hit the first text fetch before the session
   * cookie is usable; re-open the session (which refreshes the access token)
   * and retry once instead of showing an empty text layer.
   */
  private async fetchTextWithSessionRetry(bookId: string, pageNumber: number): Promise<PdfTextItem[]> {
    const fetchText = this.fetchText;
    const openSession = this.openSession;
    if (!fetchText || !openSession) {
      throw new OfflineStorageError('Network reading is not configured for this repository');
    }
    try {
      const text = await fetchText(bookId, pageNumber);
      return text.items;
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      await openSession(bookId);
      const retry = await fetchText(bookId, pageNumber);
      return retry.items;
    }
  }
}

/** `fetchText` throws `Reader request failed with 401` on an expired session. */
function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && error.message.includes('401');
}
