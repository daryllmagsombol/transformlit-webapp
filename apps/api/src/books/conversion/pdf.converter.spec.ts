import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { LocalStorageAdapter } from '../../storage/local-storage.adapter.js';
import { buildTestPdf } from '../../../test/fixtures/build-pdf';
import { buildJpxPdf } from '../../../test/fixtures/build-jpx-pdf';
import { PdfConverter } from './pdf.converter.js';

/**
 * Serves the installed `pdfjs-dist/wasm` directory over HTTP on an ephemeral
 * port. Tests use this instead of the default `file://` path because Node
 * cannot `fetch()` file URLs and the JS fallback is not loadable inside Jest's
 * CJS module registry; HTTP lets the real OpenJPEG wasm decoder run.
 */
async function startWasmServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const wasmDir = join(dirname(require.resolve('pdfjs-dist/package.json')), 'wasm');
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').split('?')[0].replace(/^\//, '');
    if (!name || name.includes('..')) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const file = join(wasmDir, name);
    if (extname(file) === '.wasm') response.setHeader('Content-Type', 'application/wasm');
    createReadStream(file)
      .on('error', () => {
        response.statusCode = 404;
        response.end();
      })
      .pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('wasm server did not bind a port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Rasterized-pixel stats, used to prove a frame is not a blank white page. */
async function measurePng(png: Buffer): Promise<{ min: number; max: number; nonWhite: number }> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let min = 255;
  let max = 0;
  let nonWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value < 240) nonWhite += 1;
  }
  return { min, max, nonWhite };
}

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

  it('rasterizes a JPEG2000 (JPXDecode) page image to non-blank pixels', async () => {
    // Regression guard for scanned PDFs: without the pdfjs-dist decoder
    // resources, this JPX image decodes to nothing and the frame is pure white.
    const wasm = await startWasmServer();
    process.env.PDFJS_WASM_URL = wasm.url;
    try {
      const result = await converter.convert({
        bookId: 'jpx-book',
        contentVersion: 1,
        buffer: buildJpxPdf(),
      });

      expect(result.pageCount).toBe(1);
      const asset = result.pages[0].assetKey;
      const saved = await storage.getBuffer(asset);
      expect(saved).not.toBeNull();

      const pixels = await measurePng(saved as Buffer);
      expect(pixels.nonWhite).toBeGreaterThan(0);
      expect(pixels.min).toBeLessThan(pixels.max);
    } finally {
      delete process.env.PDFJS_WASM_URL;
      await wasm.close();
    }
  });
});
