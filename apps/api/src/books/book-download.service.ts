import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage/storage-adapter.js';
import { BooksService } from './books.service.js';

/** Contract version of the offline manifest envelope. */
export const OFFLINE_MANIFEST_CONTRACT_VERSION = 1;

/** Injected pool boundary for download asset reads. Registered in BooksModule. */
export const DOWNLOAD_CONCURRENCY_LIMITER = Symbol('DOWNLOAD_CONCURRENCY_LIMITER');

/** Maximum simultaneous download asset reads across the process. */
export const DOWNLOAD_CONCURRENCY_LIMIT = 8;

export type DownloadAssetKind = 'PAGE_IMAGE' | 'TEXT_LAYER' | 'COVER';

export interface OfflineTocEntry {
  id: string;
  title: string;
  pageNumber: number;
  order: number;
}

export interface OfflinePageEntry {
  pageNumber: number;
  imageAssetId: string;
  textLayerAssetId: string;
}

export interface OfflineAssetEntry {
  assetId: string;
  kind: DownloadAssetKind;
  pageNumber: number | null;
  mediaType: string;
  byteLength: number;
  sha256: string;
  width: number | null;
  height: number | null;
  /** Application-relative, version-pinned URL; storage keys stay private. */
  url: string;
}

export interface OfflineBookManifest {
  contractVersion: number;
  bookId: string;
  contentVersion: number;
  title: string;
  author: string | null;
  description: string | null;
  coverAssetId: string | null;
  totalPages: number;
  toc: OfflineTocEntry[];
  pages: OfflinePageEntry[];
  assets: OfflineAssetEntry[];
}

export interface DownloadAsset {
  buffer: Buffer;
  mediaType: string;
  byteLength: number;
  sha256: string;
  kind: 'frame' | 'text';
  pageNumber: number;
}

const TEXT_MEDIA_TYPE = 'application/json';
const FRAME_SUFFIX = ':frame';
const TEXT_SUFFIX = ':text';

export function frameAssetId(pageId: string): string {
  return `${pageId}${FRAME_SUFFIX}`;
}

export function textAssetId(pageId: string): string {
  return `${pageId}${TEXT_SUFFIX}`;
}

/**
 * Bounds how much download work can run at once, independently of the reading
 * session/analytics budget. A whole-book download is many asset requests; the
 * http-level throttle alone would let one client open an unbounded number of
 * simultaneous reads, so the service also caps in-flight asset fetches.
 */
export class DownloadConcurrencyLimiter {
  private active = 0;

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      // 503, not 500: this is transient backpressure and the client should retry.
      throw new ServiceUnavailableException('Download is busy; too many concurrent download requests');
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
    }
  }
}

interface VersionPage {
  id: string;
  index: number;
  assetKey: string;
  textKey: string | null;
  hasTextLayer: boolean;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  frameByteLength: number | null;
  frameSha256: string | null;
  textByteLength: number | null;
  textSha256: string | null;
}

interface VersionRecord {
  id: string;
  bookId: string;
  contentVersion: number;
  title: string;
  author: string | null;
  description: string | null;
  format: string | null;
  pageCount: number;
  eligible: boolean;
  pages: VersionPage[];
  tocEntries: Array<{ id: string; title: string; page: number; depth: number; order: number }>;
}

@Injectable()
export class BookDownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(DOWNLOAD_CONCURRENCY_LIMITER) private readonly limiter: DownloadConcurrencyLimiter,
  ) {}

  private sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async getManifest(bookId: string, userId: string, contentVersion?: number): Promise<OfflineBookManifest> {
    await this.books.assertCanRead(bookId, userId);
    const version = contentVersion === undefined
      ? ((await this.books.findLatestEligibleContentVersion(bookId)) as VersionRecord | null)
      : ((await this.books.findEligibleContentVersion(bookId, contentVersion)) as VersionRecord | null);

    if (!version) throw new NotFoundException('Content version not available for download');
    return this.buildManifest(version);
  }

  private buildManifest(version: VersionRecord): OfflineBookManifest {
    this.assertComplete(version);
    const pages: OfflinePageEntry[] = [];
    const assets: OfflineAssetEntry[] = [];
    const assetUrl = (assetId: string): string =>
      `/books/${version.bookId}/content/${version.contentVersion}/assets/${assetId}`;

    for (const page of version.pages) {
      pages.push({
        pageNumber: page.index,
        imageAssetId: frameAssetId(page.id),
        textLayerAssetId: textAssetId(page.id),
      });
      assets.push(
        {
          assetId: frameAssetId(page.id),
          kind: 'PAGE_IMAGE',
          pageNumber: page.index,
          mediaType: page.mimeType ?? 'image/png',
          byteLength: page.frameByteLength,
          sha256: page.frameSha256,
          width: page.width,
          height: page.height,
          url: assetUrl(frameAssetId(page.id)),
        },
        {
          assetId: textAssetId(page.id),
          kind: 'TEXT_LAYER',
          pageNumber: page.index,
          mediaType: TEXT_MEDIA_TYPE,
          byteLength: page.textByteLength,
          sha256: page.textSha256,
          width: null,
          height: null,
          url: assetUrl(textAssetId(page.id)),
        },
      );
    }

    return {
      contractVersion: OFFLINE_MANIFEST_CONTRACT_VERSION,
      bookId: version.bookId,
      contentVersion: version.contentVersion,
      title: version.title,
      author: version.author,
      description: version.description,
      coverAssetId: null,
      totalPages: version.pageCount,
      toc: version.tocEntries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        pageNumber: entry.page,
        order: entry.order,
      })),
      pages,
      assets,
    };
  }

  /**
   * A published page with a missing frame or text layer, an unchecksummed
   * descriptor, or a page count that does not match the retained page set is
   * not downloadable. Failing the manifest is the point: never fabricate a
   * checksum or an empty page just to produce a "complete" manifest.
   */
  private assertComplete(version: VersionRecord): void {
    if (version.pageCount < 1 || version.pages.length !== version.pageCount) {
      throw new NotFoundException('Content version is incomplete');
    }
    for (const page of version.pages) {
      const hasFrame = page.assetKey.length > 0 && page.frameSha256 !== null && (page.frameByteLength ?? 0) > 0;
      const hasText = page.hasTextLayer && page.textKey !== null && page.textSha256 !== null && (page.textByteLength ?? 0) > 0;
      if (!hasFrame || !hasText) throw new NotFoundException('Content version is incomplete');
    }
  }

  /** Resolves a page into its immutable asset descriptor, pinned to `version`. */
  async getAsset(
    bookId: string,
    userId: string,
    contentVersion: number,
    pageNumber: number,
    kind: 'frame' | 'text',
  ): Promise<DownloadAsset> {
    await this.books.assertCanRead(bookId, userId);
    const version = (await this.books.findEligibleContentVersion(bookId, contentVersion)) as VersionRecord | null;
    if (!version) throw new NotFoundException('Content version not available for download');

    const page = version.pages.find((candidate) => candidate.index === pageNumber);
    if (!page) throw new NotFoundException('Page not found in content version');
    return this.readAsset(version, page, kind);
  }

  /** Resolves the contract's opaque asset id without ever trusting a storage key. */
  async getAssetById(
    bookId: string,
    userId: string,
    contentVersion: number,
    assetId: string,
  ): Promise<DownloadAsset> {
    await this.books.assertCanRead(bookId, userId);
    const version = (await this.books.findEligibleContentVersion(bookId, contentVersion)) as VersionRecord | null;
    if (!version) throw new NotFoundException('Content version not available for download');

    const parsed = this.parseAssetId(assetId);
    const page = parsed ? version.pages.find((candidate) => candidate.id === parsed.pageId) : undefined;
    if (!parsed || !page) throw new NotFoundException('Asset not found in content version');
    return this.readAsset(version, page, parsed.kind);
  }

  private parseAssetId(assetId: string): { pageId: string; kind: 'frame' | 'text' } | null {
    if (assetId.endsWith(FRAME_SUFFIX)) return { pageId: assetId.slice(0, -FRAME_SUFFIX.length), kind: 'frame' };
    if (assetId.endsWith(TEXT_SUFFIX)) return { pageId: assetId.slice(0, -TEXT_SUFFIX.length), kind: 'text' };
    return null;
  }

  private async readAsset(
    version: VersionRecord,
    page: VersionPage,
    kind: 'frame' | 'text',
  ): Promise<DownloadAsset> {
    const storageKey = kind === 'frame' ? page.assetKey : page.textKey;
    if (!storageKey) throw new NotFoundException('Asset not present in content version');

    const buffer = await this.limiter.run(() => this.storage.getBuffer(storageKey));
    if (!buffer) throw new NotFoundException('Asset bytes are missing');

    const expectedLength = kind === 'frame' ? page.frameByteLength : page.textByteLength;
    const expectedSha256 = kind === 'frame' ? page.frameSha256 : page.textSha256;
    const actualSha256 = this.sha256(buffer);
    if (expectedSha256 === null || buffer.byteLength !== expectedLength || actualSha256 !== expectedSha256) {
      throw new InternalServerErrorException('Download asset integrity check failed for this content version');
    }

    return {
      buffer,
      mediaType: kind === 'frame' ? (page.mimeType ?? 'image/png') : TEXT_MEDIA_TYPE,
      byteLength: buffer.byteLength,
      sha256: actualSha256,
      kind,
      pageNumber: page.index,
    };
  }

  /**
   * Verifies every page's stored frame/text bytes against a version's metadata
   * and marks it eligible only when all assets exist. Returns `false` without
   * writing anything when any asset is missing — checksums and text are never
   * fabricated for a legacy version we cannot verify.
   */
  async backfillVersion(bookId: string, contentVersion: number): Promise<boolean> {
    const version = await this.prisma.bookContentVersion.findUnique({
      where: { bookId_contentVersion: { bookId, contentVersion } },
      include: { pages: { orderBy: { index: 'asc' } } },
    });
    if (!version || version.pages.length === 0) return false;
    // A published version is only eligible when its page set is complete and
    // every page advertises both a frame and a text layer; otherwise it stays
    // ineligible. We never fabricate an empty page or text layer to qualify.
    if (version.pages.length !== version.pageCount) return false;
    if (version.pages.some((page) => !page.assetKey || !page.textKey || !page.hasTextLayer)) return false;

    const pageUpdates: Array<{ id: string; frameByteLength: number; frameSha256: string; textByteLength: number; textSha256: string }> = [];
    for (const page of version.pages) {
      const frame = await this.storage.getBuffer(page.assetKey);
      if (!frame) return false;
      const text = await this.storage.getBuffer(page.textKey as string);
      if (!text) return false;
      pageUpdates.push({
        id: page.id,
        frameByteLength: frame.byteLength,
        frameSha256: this.sha256(frame),
        textByteLength: text.byteLength,
        textSha256: this.sha256(text),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const update of pageUpdates) {
        await tx.bookContentVersionPage.update({
          where: { id: update.id },
          data: {
            frameByteLength: update.frameByteLength,
            frameSha256: update.frameSha256,
            textByteLength: update.textByteLength,
            textSha256: update.textSha256,
          },
        });
      }
      await tx.bookContentVersion.update({
        where: { id: version.id },
        data: { eligible: true, verifiedAt: new Date() },
      });
    });
    return true;
  }

  /**
   * Promotes every not-yet-eligible version whose real assets verify.
   *
   * Pages deterministically through ALL ineligible rows using an ascending
   * `(bookId, contentVersion)` keyset cursor until exhausted. A permanently
   * unverifiable row stays `eligible = false` forever, so a fixed `take` without
   * a cursor would let skipped rows occupy the front of every run and starve
   * later verifiable versions. The cursor advances past rows already examined in
   * this invocation, so a single run reaches later versions regardless of how
   * many unverifiable rows precede them.
   *
   * `batchSize` bounds each database round-trip, not total work. Refusal is
   * preserved: verification failure leaves a version ineligible and reports it
   * as skipped; checksums and text are never fabricated.
   */
  async backfillAllIneligible(batchSize = 100): Promise<BackfillSummary> {
    if (batchSize < 1) throw new BadRequestException('Backfill batch size must be at least 1');

    const promoted: BackfillResult[] = [];
    const skipped: BackfillResult[] = [];
    let examined = 0;
    let cursor: BackfillResult | null = null;

    for (;;) {
      const batch = (await this.prisma.bookContentVersion.findMany({
        where: {
          eligible: false,
          ...(cursor
            ? {
                OR: [
                  { bookId: { gt: cursor.bookId } },
                  { bookId: cursor.bookId, contentVersion: { gt: cursor.contentVersion } },
                ],
              }
            : {}),
        },
        orderBy: [{ bookId: 'asc' }, { contentVersion: 'asc' }],
        take: batchSize,
        select: { bookId: true, contentVersion: true },
      })) as BackfillResult[];

      if (batch.length === 0) break;

      for (const candidate of batch) {
        examined += 1;
        const result = { bookId: candidate.bookId, contentVersion: candidate.contentVersion };
        if (await this.backfillVersion(candidate.bookId, candidate.contentVersion)) promoted.push(result);
        else skipped.push(result);
      }

      // The keyset strictly advances because (bookId, contentVersion) is unique,
      // so this terminates even when every row in the batch is skipped.
      cursor = batch.at(-1);
      if (batch.length < batchSize) break;
    }

    return { examined, promoted, skipped };
  }
}

export interface BackfillResult {
  bookId: string;
  contentVersion: number;
}

export interface BackfillSummary {
  examined: number;
  promoted: BackfillResult[];
  skipped: BackfillResult[];
}
