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
    const alpha = parsed.items.find((item) => item.t.includes('Alpha'));
    expect(alpha).toBeDefined();
    // Fixture page is 612x792 with the text baseline at x=72, y=692 and a 24pt
    // Helvetica font. Pin known normalized values so a uniform scaling error
    // (e.g. normalizing by the render viewport instead of the CSS viewport)
    // cannot pass the loose 0..1 bounds.
    expect(alpha?.x).toBeCloseTo(72 / 612, 3);
    expect(alpha?.y).toBeCloseTo(76 / 792, 3);
    expect(alpha?.h).toBeCloseTo(24 / 792, 3);
    expect(alpha?.w).toBeCloseTo(156.1 / 612, 2);
    if (alpha) {
      expect(alpha.x).toBeGreaterThanOrEqual(0);
      expect(alpha.x).toBeLessThanOrEqual(1);
      expect(alpha.y).toBeGreaterThanOrEqual(0);
      expect(alpha.y).toBeLessThanOrEqual(1);
      expect(alpha.w).toBeGreaterThanOrEqual(0);
      expect(alpha.w).toBeLessThanOrEqual(1);
      expect(alpha.h).toBeGreaterThanOrEqual(0);
      expect(alpha.h).toBeLessThanOrEqual(1);
    }
    expect(result.toc.length).toBeGreaterThanOrEqual(1);
  });
});
