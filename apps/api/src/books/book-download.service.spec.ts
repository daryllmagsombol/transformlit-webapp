import { createHash } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookDownloadService, DownloadConcurrencyLimiter } from './book-download.service';

const sha256Hex = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

const FRAME = Buffer.from('frame-bytes');
const TEXT = Buffer.from('{"items":[]}');

function pageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    contentVersionId: 'cv-1',
    index: 1,
    assetKey: 'books/book-1/v2/pages/1.png',
    textKey: 'books/book-1/v2/pages/1.json',
    hasTextLayer: true,
    mimeType: 'image/png',
    width: 1224,
    height: 1584,
    charCount: 0,
    frameByteLength: FRAME.byteLength,
    frameSha256: sha256Hex(FRAME),
    textByteLength: TEXT.byteLength,
    textSha256: sha256Hex(TEXT),
    ...overrides,
  };
}

function versionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cv-1',
    bookId: 'book-1',
    contentVersion: 2,
    title: 'Pinned Book',
    author: 'Author One',
    description: 'Description',
    format: 'PDF',
    pageCount: 2,
    eligible: true,
    verifiedAt: new Date('2026-10-01T00:00:00Z'),
    pages: [
      pageRow(),
      pageRow({ id: 'page-2', index: 2, assetKey: 'books/book-1/v2/pages/2.png', textKey: 'books/book-1/v2/pages/2.json' }),
    ],
    tocEntries: [{ id: 'toc-1', title: 'Chapter 1', page: 1, depth: 0, order: 0 }],
    ...overrides,
  };
}

function build(record: Record<string, unknown> | null = versionRecord()) {
  const prisma = {
    bookContentVersion: {
      findUnique: jest.fn().mockResolvedValue(record),
      update: jest.fn().mockResolvedValue({}),
    },
    bookContentVersionPage: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  };
  const books = {
    assertCanRead: jest.fn().mockResolvedValue({ id: 'book-1', pageCount: 2, contentVersion: 2 }),
    findEligibleContentVersion: jest.fn().mockResolvedValue(record),
    findLatestEligibleContentVersion: jest.fn().mockResolvedValue(record),
  };
  const storage = { getBuffer: jest.fn().mockResolvedValue(FRAME) };
  const limiter = new DownloadConcurrencyLimiter(4);
  const service = new BookDownloadService(prisma as never, books as never, storage as never, limiter);
  return { service, prisma, books, storage, limiter };
}

describe('BookDownloadService', () => {
  it('builds a complete manifest pinned to the requested version with checksums and asset URLs', async () => {
    const { service, books } = build();
    const manifest = await service.getManifest('book-1', 'user-1', 2);

    expect(books.assertCanRead).toHaveBeenCalledWith('book-1', 'user-1');
    expect(books.findEligibleContentVersion).toHaveBeenCalledWith('book-1', 2);
    expect(manifest).toMatchObject({
      contractVersion: 1,
      bookId: 'book-1',
      contentVersion: 2,
      title: 'Pinned Book',
      author: 'Author One',
      description: 'Description',
      coverAssetId: null,
      totalPages: 2,
    });
    expect(manifest.toc).toEqual([{ id: 'toc-1', title: 'Chapter 1', pageNumber: 1, order: 0 }]);
    expect(manifest.pages).toHaveLength(2);
    expect(manifest.pages[0]).toEqual({
      pageNumber: 1,
      imageAssetId: 'page-1:frame',
      textLayerAssetId: 'page-1:text',
    });
    expect(manifest.assets).toHaveLength(4);
    expect(manifest.assets.map((asset) => asset.kind)).toEqual([
      'PAGE_IMAGE',
      'TEXT_LAYER',
      'PAGE_IMAGE',
      'TEXT_LAYER',
    ]);
    for (const asset of manifest.assets) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.byteLength).toBeGreaterThan(0);
      expect(asset.url).toBe(`/books/book-1/content/2/assets/${asset.assetId}`);
    }
    expect(manifest.assets[0]).toMatchObject({
      assetId: 'page-1:frame',
      kind: 'PAGE_IMAGE',
      pageNumber: 1,
      mediaType: 'image/png',
      byteLength: FRAME.byteLength,
      sha256: sha256Hex(FRAME),
      width: 1224,
      height: 1584,
    });
    expect(manifest.assets[1]).toMatchObject({
      assetId: 'page-1:text',
      kind: 'TEXT_LAYER',
      pageNumber: 1,
      mediaType: 'application/json',
      byteLength: TEXT.byteLength,
      sha256: sha256Hex(TEXT),
    });
  });

  it('resolves the latest eligible retained version when none is requested', async () => {
    const { service, books } = build();
    await service.getManifest('book-1', 'user-1');

    expect(books.findLatestEligibleContentVersion).toHaveBeenCalledWith('book-1');
    expect(books.findEligibleContentVersion).not.toHaveBeenCalled();
  });

  it('keeps a pinned version internally consistent after the current pointer moves on', async () => {
    const v1 = versionRecord({
      contentVersion: 1,
      pageCount: 1,
      pages: [pageRow({ assetKey: 'books/book-1/v1/pages/1.png' })],
      tocEntries: [{ id: 'toc-v1', title: 'Old', page: 1, depth: 0, order: 0 }],
    });
    const { service, books } = build(v1);
    books.assertCanRead.mockResolvedValue({ id: 'book-1', pageCount: 2, contentVersion: 2 });

    const manifest = await service.getManifest('book-1', 'user-1', 1);
    expect(manifest.contentVersion).toBe(1);
    expect(manifest.assets.every((asset) => asset.url.includes('/content/1/'))).toBe(true);
  });

  it('never exposes internal storage keys in the manifest', async () => {
    const { service } = build();
    const manifest = await service.getManifest('book-1', 'user-1', 2);
    const serialized = JSON.stringify(manifest);
    // Storage keys look like `books/<id>/v<n>/pages/<n>.png`; the contract only
    // ever exposes opaque asset ids and application-relative asset URLs.
    expect(serialized).not.toContain('v2/pages');
    expect(serialized).not.toContain('.png');
    expect(serialized).not.toContain('.json');
    expect(serialized).not.toContain('assetKey');
    expect(serialized).not.toContain('textKey');
  });

  it('returns 404 for an unknown or ineligible retained version', async () => {
    const { service, books } = build();
    books.findEligibleContentVersion.mockResolvedValue(null);
    await expect(service.getManifest('book-1', 'user-1', 99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to emit a manifest for an incomplete version (missing text layer)', async () => {
    const incomplete = versionRecord({
      pages: [pageRow({ textKey: null, hasTextLayer: false, textSha256: null, textByteLength: null })],
    });
    const { service } = build(incomplete);
    await expect(service.getManifest('book-1', 'user-1', 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to emit a manifest when pages do not cover the full page count', async () => {
    const incomplete = versionRecord({ pageCount: 3 });
    const { service } = build(incomplete);
    await expect(service.getManifest('book-1', 'user-1', 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serves version-pinned asset bytes from immutable metadata with its sha256', async () => {
    const { service, storage, prisma } = build();
    const asset = await service.getAssetById('book-1', 'user-1', 2, 'page-1:frame');

    expect(storage.getBuffer).toHaveBeenCalledWith('books/book-1/v2/pages/1.png');
    expect(asset.buffer).toEqual(FRAME);
    expect(asset.sha256).toBe(sha256Hex(FRAME));
    expect(asset.byteLength).toBe(FRAME.byteLength);
    expect(asset.mediaType).toBe('image/png');
    expect(asset.kind).toBe('frame');
    expect(asset.pageNumber).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('serves an explicit empty text layer as a valid asset', async () => {
    const { service, storage } = build();
    storage.getBuffer.mockResolvedValue(TEXT);
    const asset = await service.getAssetById('book-1', 'user-1', 2, 'page-1:text');
    expect(asset.buffer).toEqual(TEXT);
    expect(asset.mediaType).toBe('application/json');
    expect(asset.kind).toBe('text');
  });

  it('rejects unknown asset ids and missing asset bytes explicitly', async () => {
    const { service, storage } = build();
    await expect(service.getAssetById('book-1', 'user-1', 2, 'nope:frame')).rejects.toBeInstanceOf(NotFoundException);
    storage.getBuffer.mockResolvedValue(null);
    await expect(service.getAssetById('book-1', 'user-1', 2, 'page-1:frame')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('propagates the current book-access check for every download action', async () => {
    const { service, books } = build();
    books.assertCanRead.mockRejectedValue(new ForbiddenException('no access'));
    await expect(service.getManifest('book-1', 'user-1', 2)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getAssetById('book-1', 'user-1', 2, 'page-1:frame')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails explicitly rather than serving mixed content when bytes no longer match the pinned checksum', async () => {
    const { service, storage } = build();
    storage.getBuffer.mockResolvedValue(Buffer.from('tampered-bytes'));
    await expect(service.getAssetById('book-1', 'user-1', 2, 'page-1:frame')).rejects.toThrow(/checksum|integrity/i);
  });

  it('backfills checksums only from verified existing assets, never fabricating', async () => {
    const legacy = versionRecord({
      eligible: false,
      verifiedAt: null,
      pageCount: 1,
      pages: [pageRow({ frameByteLength: 0, frameSha256: null, textByteLength: null, textSha256: null })],
    });
    const { service, storage, prisma } = build(legacy);
    storage.getBuffer.mockResolvedValueOnce(FRAME).mockResolvedValueOnce(TEXT);

    expect(await service.backfillVersion('book-1', 2)).toBe(true);
    expect(prisma.bookContentVersionPage.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: expect.objectContaining({
        frameByteLength: FRAME.byteLength,
        frameSha256: sha256Hex(FRAME),
        textByteLength: TEXT.byteLength,
        textSha256: sha256Hex(TEXT),
      }),
    });
    expect(prisma.bookContentVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eligible: true }) }),
    );
  });

  it('leaves a version ineligible and writes nothing when an asset cannot be verified', async () => {
    const legacy = versionRecord({ eligible: false, verifiedAt: null });
    const { service, storage, prisma } = build(legacy);
    storage.getBuffer.mockResolvedValue(null);

    expect(await service.backfillVersion('book-1', 2)).toBe(false);
    expect(prisma.bookContentVersionPage.update).not.toHaveBeenCalled();
    expect(prisma.bookContentVersion.update).not.toHaveBeenCalled();
  });

  it('bounds concurrent download work independent of reading analytics', async () => {
    const limiter = new DownloadConcurrencyLimiter(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
    };
    const first = limiter.run(task);
    await Promise.resolve();
    await expect(limiter.run(task)).rejects.toThrow(/busy|concurren/i);
    release();
    await first;
    expect(peak).toBe(1);
  });
});
