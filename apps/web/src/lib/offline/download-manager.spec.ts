import { createHash } from 'node:crypto';
import '../../../test/helpers/offline-dom-shims';
import {
  DownloadIntegrityError,
  DownloadFencedError,
  OfflineStorageError,
  QuotaExceededError,
  RightsBlockedError,
  qualifyKey,
} from './contracts';
import { OfflineDatabase, resetOfflineDatabaseHandle } from './database';
import {
  DownloadManager,
  DownloadHttpError,
  resolveAssetUrl,
  stripApiPrefix,
  type DownloadManagerDeps,
  type DownloadProgress,
} from './download-manager';
import { createMemoryIndexedDb, memoryIdbKeyRange, type MemoryIndexedDb } from '../../../test/helpers/memory-indexeddb';
import type { BibleChapter } from '../bible/types';

const SUBJECT = 'subject-a';
const EPOCH = 1;
const BOOK_ID = 'book-1';
const PERMITTED_TRANSLATION = 'PERMITTED';

beforeAll(() => {
  if (typeof globalThis.IDBKeyRange === 'undefined') {
    Object.defineProperty(globalThis, 'IDBKeyRange', { writable: true, value: memoryIdbKeyRange });
  }
});

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
}

interface FixtureAsset {
  assetId: string;
  kind: 'PAGE_IMAGE' | 'TEXT_LAYER';
  pageNumber: number;
  mediaType: string;
  bytes: Uint8Array;
  sha256: string;
  byteLength: number;
}

function buildAsset(assetId: string, kind: FixtureAsset['kind'], pageNumber: number, content: string): FixtureAsset {
  const bytes = new TextEncoder().encode(content);
  return {
    assetId,
    kind,
    pageNumber,
    mediaType: kind === 'PAGE_IMAGE' ? 'image/png' : 'application/json',
    bytes,
    sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    byteLength: bytes.byteLength,
  };
}

function buildManifest(contentVersion: number, pages = 2) {
  const assets: FixtureAsset[] = [];
  const pageEntries = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const image = buildAsset(`p${pageNumber}:frame`, 'PAGE_IMAGE', pageNumber, `frame-${contentVersion}-${pageNumber}`);
    const text = buildAsset(`p${pageNumber}:text`, 'TEXT_LAYER', pageNumber, JSON.stringify({ items: [contentVersion, pageNumber] }));
    assets.push(image, text);
    pageEntries.push({ pageNumber, imageAssetId: image.assetId, textLayerAssetId: text.assetId });
  }
  return {
    contractVersion: 1,
    bookId: BOOK_ID,
    contentVersion,
    title: 'Test Book',
    author: 'Author',
    description: null,
    coverAssetId: null,
    totalPages: pages,
    toc: [{ id: 'toc-1', title: 'Chapter 1', pageNumber: 1, order: 1 }],
    pages: pageEntries,
    assets: assets.map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      pageNumber: asset.pageNumber,
      mediaType: asset.mediaType,
      byteLength: asset.byteLength,
      sha256: asset.sha256,
      url: `/books/${BOOK_ID}/content/${contentVersion}/assets/${asset.assetId}`,
    })),
    __bytes: assets,
  };
}

type BuiltManifest = ReturnType<typeof buildManifest>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function binaryResponse(bytes: Uint8Array): Response {
  return new Response(Buffer.from(bytes), { status: 200 });
}

function createHarness(
  options: {
    concurrency?: number;
    onProgress?: (p: DownloadProgress) => void;
    managerClass?: typeof DownloadManager;
  } = {},
) {
  const memory: MemoryIndexedDb = createMemoryIndexedDb();
  (globalThis as { indexedDB?: unknown }).indexedDB = memory.indexedDB;
  resetOfflineDatabaseHandle();
  const database = new OfflineDatabase();

  let permitted = true;
  const writePermit = () =>
    permitted
      ? { permitted: true as const, owner: { subject: SUBJECT, epoch: EPOCH } }
      : { permitted: false as const, reason: 'NO_OWNER' as const };

  const fetchCalls: string[] = [];
  const manifests = new Map<number, BuiltManifest>();
  const assetBytes = new Map<string, Uint8Array>();
  const overrides = new Map<string, Uint8Array>();
  let manifestVersion = 1;
  let failAssetWith: { assetId: string; response: Response } | null = null;
  let inflight = 0;
  let maxInflight = 0;
  let delay: (() => Promise<void>) | null = null;

  function registerManifest(manifest: BuiltManifest): void {
    manifests.set(manifest.contentVersion, manifest);
    for (const asset of manifest.__bytes) assetBytes.set(asset.assetId, asset.bytes);
  }

  registerManifest(buildManifest(1));

  const fetchImpl = async (input: string): Promise<Response> => {
    fetchCalls.push(input);
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    try {
      if (delay) await delay();
      const { pathname } = new URL(input);
      if (pathname.endsWith('/offline-manifest')) {
        const requested = new URL(input).searchParams.get('contentVersion');
        const version = requested ? Number(requested) : manifestVersion;
        const manifest = manifests.get(version);
        if (!manifest) return new Response('not found', { status: 404 });
        return jsonResponse({ ...manifest, __bytes: undefined });
      }
      if (pathname.includes('/ROM/8.json')) {
        return jsonResponse(permittedBibleChapter());
      }
      const assetId = pathname.slice(pathname.lastIndexOf('/') + 1);
      if (failAssetWith && failAssetWith.assetId === assetId) return failAssetWith.response;
      const bytes = overrides.get(assetId) ?? assetBytes.get(assetId);
      if (!bytes) return new Response('not found', { status: 404 });
      return binaryResponse(bytes);
    } finally {
      inflight -= 1;
    }
  };

  const ManagerClass = options.managerClass ?? DownloadManager;
  const manager = new ManagerClass({
    database,
    lifecycle: { writePermit },
    apiBase: 'http://localhost:3005/api',
    bibleApiBase: 'https://bible.example/api',
    fetchImpl,
    fetchBibleChapter: async (translation, book, chapter) => {
      const response = await fetchImpl(`https://bible.example/api/${translation}/${book}/${chapter}.json`);
      return (await response.json()) as BibleChapter;
    },
    sha256,
    now: () => 1_700_000_000_000,
    concurrency: options.concurrency ?? 3,
    onProgress: options.onProgress,
    getToken: () => 'token',
  });

  return {
    memory,
    database,
    manager,
    fetchCalls,
    assetBytes,
    overrides,
    registerManifest,
    setPermitted: (value: boolean) => {
      permitted = value;
    },
    setDelay: (value: (() => Promise<void>) | null) => {
      delay = value;
    },
    setManifestVersion: (value: number) => {
      manifestVersion = value;
    },
    failAsset: (assetId: string, response: Response) => {
      failAssetWith = { assetId, response };
    },
    clearAssetFailure: () => {
      failAssetWith = null;
    },
    maxInflight: () => maxInflight,
  };
}

/** A manager that treats one test-only translation as having documented rights. */
class PermittedDownloadManager extends DownloadManager {
  protected override rightsFor(translation: string) {
    if (translation !== PERMITTED_TRANSLATION) return super.rightsFor(translation);
    return {
      translationId: translation,
      evidence: 'DOCUMENTED' as const,
      evidenceSource: 'test://evidence',
      grant: { redistribution: true, offlineStorage: true, formatConversion: true },
      attribution: 'Example Attribution',
    };
  }
}

async function seedLifecycle(database: OfflineDatabase): Promise<void> {
  await database.writeLifecycle({ id: 'lifecycle', state: 'ACTIVE', subject: SUBJECT, epoch: EPOCH, updatedAt: 1 });
}

function permittedBibleChapter() {
  return {
    translation: { id: 'PERMITTED', name: 'Permitted Version', shortName: 'PV' },
    book: {
      id: 'ROM',
      name: 'Romans',
      commonName: 'Romans',
      title: null,
      order: 45,
      numberOfChapters: 16,
      firstChapterNumber: 1,
      lastChapterNumber: 16,
      totalNumberOfVerses: 433,
    },
    thisChapterLink: '/api/PERMITTED/ROM/8.json',
    nextChapterApiLink: null,
    previousChapterApiLink: null,
    numberOfVerses: 2,
    chapter: {
      number: 8,
      content: [{ type: 'verse', number: 1, content: ['There is therefore now'] }],
      footnotes: [{ noteId: 0, text: 'A footnote', caller: 'a' }],
    },
  };
}

describe('download manager', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    resetOfflineDatabaseHandle();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  describe('asset URL reconciliation', () => {
    it('strips a duplicate /api prefix from a manifest path', () => {
      expect(stripApiPrefix('/api/books/b1')).toBe('/books/b1');
      expect(stripApiPrefix('/books/b1')).toBe('/books/b1');
    });

    it('resolves a prefix-less manifest path against the client base', () => {
      expect(resolveAssetUrl('https://host/api', '/books/b1/content/2/assets/a')).toBe(
        'https://host/api/books/b1/content/2/assets/a',
      );
    });

    it('resolves a manifest path that already carries /api without doubling it', () => {
      expect(resolveAssetUrl('https://host/api', '/api/books/b1/content/2/assets/a')).toBe(
        'https://host/api/books/b1/content/2/assets/a',
      );
    });

    it('keeps an absolute manifest URL origin-free and rebased', () => {
      expect(resolveAssetUrl('https://host/api', 'https://other/books/b1/content/2/assets/a')).toBe(
        'https://host/api/books/b1/content/2/assets/a',
      );
    });
  });

  describe('book download state machine', () => {
    it('publishes READY only after every page asset verifies', async () => {
      await seedLifecycle(harness.database);
      const status = await harness.manager.startBookDownload(BOOK_ID);
      expect(status.status).toBe('READY');
      expect(status.activeVersion).toBe(1);
      expect(status.completedItems).toBe(status.itemCount);
    });

    it('fails when a page asset digest does not match the manifest', async () => {
      await seedLifecycle(harness.database);
      harness.failAsset('p2:frame', binaryResponse(new TextEncoder().encode('tampered')));
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toBeInstanceOf(DownloadIntegrityError);
      const status = await harness.manager.getBookStatus(BOOK_ID);
      expect(status?.status).not.toBe('READY');
      expect(status?.activeVersion).toBeNull();
    });

    it('fails when an asset byte length does not match the manifest', async () => {
      await seedLifecycle(harness.database);
      // Serve fewer bytes than the manifest advertises for this asset.
      harness.overrides.set('p1:text', new TextEncoder().encode('short'));
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toBeInstanceOf(DownloadIntegrityError);
    });

    it('records an INTERRUPTED state and never becomes ready when a transfer aborts', async () => {
      await seedLifecycle(harness.database);
      harness.failAsset('p2:text', new Response('boom', { status: 500 }));
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toThrow();
      const status = await harness.manager.getBookStatus(BOOK_ID);
      expect(status?.status).toBe('INTERRUPTED');
      expect(status?.activeVersion).toBeNull();

      const reread = await harness.manager.getBookStatus(BOOK_ID);
      expect(reread?.status).not.toBe('READY');
    });

    it.each([401, 403])('classifies HTTP %i as a terminal access denial', async (statusCode) => {
      await seedLifecycle(harness.database);
      harness.failAsset('p2:frame', new Response('denied', { status: statusCode }));
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toBeInstanceOf(DownloadHttpError);
      const status = await harness.manager.getBookStatus(BOOK_ID);
      expect(status?.status).toBe('FAILED');
      expect(status?.error).toMatch(/no longer have access/i);
    });

    it.each([404, 410])('classifies HTTP %i as terminal unavailable content', async (statusCode) => {
      await seedLifecycle(harness.database);
      harness.failAsset('p2:text', new Response('gone', { status: statusCode }));
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toBeInstanceOf(DownloadHttpError);
      const status = await harness.manager.getBookStatus(BOOK_ID);
      expect(status?.status).toBe('FAILED');
      expect(status?.error).toMatch(/no longer available/i);
    });

    it('classifies a missing requested manifest version (404) as terminal', async () => {
      await seedLifecycle(harness.database);
      await expect(harness.manager.startBookDownload(BOOK_ID, 999)).rejects.toBeInstanceOf(DownloadHttpError);
      const status = await harness.manager.getBookStatus(BOOK_ID);
      expect(status?.status).toBe('FAILED');
    });

    it.each([408, 429, 500, 503])('keeps HTTP %i retryable as INTERRUPTED', async (statusCode) => {
      await seedLifecycle(harness.database);
      harness.failAsset('p2:frame', new Response('temporary', { status: statusCode }));
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toThrow();
      const status = await harness.manager.getBookStatus(BOOK_ID);
      expect(status?.status).toBe('INTERRUPTED');
    });
  });

  describe('retry', () => {
    it('re-verifies already-staged items instead of refetching their bytes', async () => {
      harness = createHarness({ concurrency: 1 });
      await seedLifecycle(harness.database);
      harness.failAsset('p2:text', new Response('boom', { status: 500 }));
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toThrow();

      const frameFetchesBefore = harness.fetchCalls.filter((call) => call.includes('p1:frame')).length;
      expect(frameFetchesBefore).toBe(1);

      harness.clearAssetFailure();
      const status = await harness.manager.retryBookDownload(BOOK_ID);
      expect(status.status).toBe('READY');

      // The verified page-1 frame was reused; it is not fetched a second time.
      const frameFetchesAfter = harness.fetchCalls.filter((call) => call.includes('p1:frame')).length;
      expect(frameFetchesAfter).toBe(1);
    });

    it('keeps whole-book transfer bounded by the configured concurrency', async () => {
      await seedLifecycle(harness.database);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      harness.setDelay(() => gate);
      const pending = harness.manager.startBookDownload(BOOK_ID);
      await Promise.resolve();
      release();
      await pending;
      expect(harness.maxInflight()).toBeLessThanOrEqual(3);
    });
  });

  describe('replacement and quota', () => {
    it('leaves the previous complete version active when the replacement hits a quota error', async () => {
      await seedLifecycle(harness.database);
      await harness.manager.startBookDownload(BOOK_ID);

      harness.registerManifest(buildManifest(2));
      harness.setManifestVersion(2);
      // Fail only the atomic publish write (the READY manifest for v2), not the
      // earlier staging writes, so the failure happens exactly at publish time.
      harness.memory.failPutWhen(
        (store, value) =>
          store === 'downloadManifests' &&
          (value as { status?: string; contentVersion?: number }).status === 'READY' &&
          (value as { contentVersion?: number }).contentVersion === 2,
      );

      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toBeInstanceOf(QuotaExceededError);

      const status = await harness.manager.getBookStatus(BOOK_ID);
      expect(status?.status).not.toBe('READY');
      expect(status?.activeVersion).toBe(1);

      const active = await harness.database.getActiveBookVersion(SUBJECT, BOOK_ID);
      expect(active?.contentVersion).toBe(1);
    });
  });

  describe('removal', () => {
    it('removes downloaded content but preserves reader records and outbox', async () => {
      await seedLifecycle(harness.database);
      await harness.manager.startBookDownload(BOOK_ID);

      await harness.database.putAccountRecord(SUBJECT, EPOCH, 'readerRecords', {
        id: qualifyKey(SUBJECT, 'highlight', 'h1'),
        subject: SUBJECT,
        bookId: BOOK_ID,
      });
      await harness.database.commitOutbox(SUBJECT, EPOCH, {
        id: qualifyKey(SUBJECT, 'op', 'o1'),
        subject: SUBJECT,
        entityKey: BOOK_ID,
      });

      await harness.manager.removeBookDownload(BOOK_ID);

      expect(await harness.manager.getBookStatus(BOOK_ID)).toBeNull();
      expect(await harness.database.getActiveBookVersion(SUBJECT, BOOK_ID)).toBeNull();
      const records = await harness.database.getAllByIndex<{ id: string }>('readerRecords', 'subject', SUBJECT);
      const outbox = await harness.database.getAllByIndex<{ id: string }>('outbox', 'subject', SUBJECT);
      expect(records).toHaveLength(1);
      expect(outbox).toHaveLength(1);
    });
  });

  describe('account fencing', () => {
    it('rejects a download started with no active owner', async () => {
      harness.setPermitted(false);
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toBeInstanceOf(DownloadFencedError);
    });

    it('rejects a late download write after sign-out fences the epoch', async () => {
      await seedLifecycle(harness.database);
      // Owner changes: epoch advances and the old subject is gone.
      await harness.database.writeLifecycle({
        id: 'lifecycle',
        state: 'SIGNED_OUT',
        subject: null,
        epoch: EPOCH + 1,
        updatedAt: 2,
      });
      harness.setPermitted(false);
      await expect(harness.manager.startBookDownload(BOOK_ID)).rejects.toBeInstanceOf(DownloadFencedError);

      // Even a direct storage write captured under the old subject/epoch is
      // fenced by the lifecycle guard rather than leaking into the store.
      const lateWrite = harness.database
        .putDownloadRecord(SUBJECT, EPOCH, 'downloadManifests', {
          id: qualifyKey(SUBJECT, 'download', 'book', 'late'),
          subject: SUBJECT,
        })
        .catch((error: unknown) => error);
      await expect(lateWrite).resolves.toBeInstanceOf(OfflineStorageError);
    });
  });

  describe('bible chapter rights gate', () => {
    it('blocks a translation with undocumented offline rights before any fetch', async () => {
      await seedLifecycle(harness.database);
      await expect(harness.manager.startBibleChapterDownload('BSB', 'ROM', 8)).rejects.toBeInstanceOf(RightsBlockedError);
      expect(harness.fetchCalls.filter((call) => call.includes('ROM'))).toHaveLength(0);
    });

    it('saves the full chapter payload with metadata, bounds, provenance and attribution', async () => {
      harness = createHarness({ managerClass: PermittedDownloadManager });
      await seedLifecycle(harness.database);
      const status = await harness.manager.startBibleChapterDownload('PERMITTED', 'ROM', 8);
      expect(status.status).toBe('READY');
      expect(status.kind).toBe('BIBLE_CHAPTER');

      const stored = await harness.database.getBibleChapter(SUBJECT, 'PERMITTED', 'ROM', 8);
      expect(stored).not.toBeNull();
      expect(stored?.attribution).toBe('Example Attribution');
      expect(stored?.translationMeta?.name).toBe('Permitted Version');
      expect(stored?.bookMeta?.commonName).toBe('Romans');
      expect(stored?.chapterBounds).toEqual({ firstChapter: 1, lastChapter: 16 });
      expect(stored?.provenance).toContain('PERMITTED');
      expect(stored?.payload).toEqual(permittedBibleChapter());
    });
  });
});

export type { BuiltManifest };
