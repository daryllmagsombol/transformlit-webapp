import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from '../../storage/local-storage.adapter.js';
import { buildTestPdf } from '../../../test/fixtures/build-pdf';
import { PdfConverter } from './pdf.converter.js';

describe('PdfConverter', () => {
  let root: string;
  let storage: LocalStorageAdapter;
  let converter: PdfConverter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pdf-convert-'));
    storage = new LocalStorageAdapter(root);
    converter = new PdfConverter(storage);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('converts a 2-page PDF into versioned page assets with text items', async () => {
    const result = await converter.convert({ bookId: 'book-1', contentVersion: 1, buffer: buildTestPdf(['Alpha', 'Beta']) });

    expect(result.format).toBe('PDF');
    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].assetKey).toBe('books/book-1/v1/pages/1.png');
    expect(result.pages[0].itemCount).toBeGreaterThan(0);
    expect(result.pages[0].width).toBeGreaterThan(0);

    expect(await storage.exists(result.pages[0].assetKey)).toBe(true);
    const saved = await storage.getBuffer(result.pages[0].textKey);
    const parsed = JSON.parse(saved?.toString() ?? '{}') as {
      items: Array<{ t: string; x: number; y: number; w: number; h: number }>;
    };
    expect(parsed.items.some((item) => item.t.includes('Alpha'))).toBe(true);
    expect(parsed.items[0].x).toBeGreaterThanOrEqual(0);
    expect(parsed.items[0].x).toBeLessThanOrEqual(1);
    expect(parsed.items[0].y).toBeGreaterThanOrEqual(0);
    expect(parsed.items[0].y).toBeLessThanOrEqual(1);
    expect(parsed.items[0].w).toBeGreaterThan(0);
    expect(parsed.items[0].w).toBeLessThanOrEqual(1);
    expect(parsed.items[0].h).toBeGreaterThan(0);
    expect(parsed.items[0].h).toBeLessThanOrEqual(1);
    expect(result.toc.length).toBeGreaterThanOrEqual(1);
  });
});
