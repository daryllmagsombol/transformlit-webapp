import { Inject, Injectable, Logger } from '@nestjs/common';
import { definePDFJSModule, getDocumentProxy, getResolvedPDFJS, renderPageAsImage } from 'unpdf';
import { pathToFileURL } from 'node:url';
import { STORAGE_ADAPTER, StorageAdapter } from '../../storage/storage-adapter.js';
import { ConvertedBook, ConvertedPage, ConvertedTocEntry, TextItemBox } from './reader.types.js';

export const RENDER_SCALE = 2;

/**
 * unpdf bundles its own pdf.js build but NOT the decoder resources, so scanned
 * PDFs whose page images are JPEG2000 (`JPXDecode`) or JBIG2 fail to decode and
 * every frame renders blank. Overriding the module once with the `pdfjs-dist`
 * legacy build (Node-safe) and pointing it at the shipped `wasm/` directory lets
 * pdf.js initialize those decoders. Node cannot `fetch()` a `file://` wasm URL,
 * so pdf.js falls back to the JS decoders shipped alongside — expected, and it
 * still rasterizes correctly. Only the JPEG2000 path is covered by tests; the
 * JBIG2 decoders share the same mechanism.
 */
export function resolvePdfjsWasmUrl(): string {
  // An explicit override wins (e.g. wasm hosted over HTTP, which Node's fetch can
  // reach directly); otherwise resolve from the installed pdfjs-dist package so
  // the path survives both the `tsx`/`nest start` dev layout and `dist`.
  const override = process.env.PDFJS_WASM_URL;
  if (override) {
    // pdf.js concatenates the filename onto this base, so a trailing slash is
    // required — otherwise both the wasm and fallback fetches 404.
    return override.endsWith('/') ? override : `${override}/`;
  }
  const packageJson = require.resolve('pdfjs-dist/package.json');
  return new URL('./wasm/', pathToFileURL(packageJson)).href;
}

/** pdf.js OPS names whose presence means a page paints a raster image. */
const IMAGE_PAINT_OP_NAMES = [
  'paintImageMaskXObject',
  'paintImageMaskXObjectGroup',
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintInlineImageXObjectGroup',
  'paintImageXObjectRepeat',
  'paintImageMaskXObjectRepeat',
  'paintSolidColorImageMask',
] as const;

/** True when an operator list paints at least one raster image. */
export function pagePaintsImages(
  fnArray: readonly number[],
  ops: Record<string, number | undefined>,
): boolean {
  const imageOpCodes = new Set(
    IMAGE_PAINT_OP_NAMES.map((name) => ops[name]).filter(
      (code): code is number => typeof code === 'number',
    ),
  );
  return fnArray.some((fn) => imageOpCodes.has(fn));
}

/** Luminance statistics for a rasterized frame (each channel 0..255). */
export interface FramePixelStats {
  min: number;
  max: number;
  nonWhite: number;
  total: number;
}

/** A frame is treated as blank when no pixel is darker than this luminance. */
export const BLANK_MIN_LUMINANCE = 250;

/** Computes luminance extremes over packed RGBA pixel data. */
export function measureLuminance(data: ArrayLike<number>): FramePixelStats {
  let min = 255;
  let max = 0;
  let nonWhite = 0;
  let total = 0;
  for (let i = 0; i + 2 < data.length; i += 4) {
    const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value < BLANK_MIN_LUMINANCE) nonWhite += 1;
    total += 1;
  }
  return { min, max, nonWhite, total };
}

/** True when the frame is effectively uniform white (nothing was drawn). */
export function isNearUniformWhite(stats: FramePixelStats): boolean {
  return stats.total > 0 && stats.min >= BLANK_MIN_LUMINANCE;
}

/** Decodes a PNG frame and measures its luminance. */
export async function measureFramePng(png: Buffer): Promise<FramePixelStats> {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas');
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return measureLuminance(data);
}

/**
 * Raised when a page that paints a raster image rasterized to uniform white —
 * i.e. the pdf.js JPEG2000/JBIG2 decoder failed silently. Failing the job is the
 * point: the worker retries and then marks the book FAILED with this message,
 * instead of publishing a reader full of blank pages.
 */
export class BlankPageError extends Error {
  constructor(
    readonly pageIndex: number,
    readonly stats: FramePixelStats,
  ) {
    super(
      `Page ${pageIndex} rasterized blank white although it paints a raster image ` +
        `(min luminance ${stats.min.toFixed(2)}); the PDF image decoder failed to initialize`,
    );
    this.name = 'BlankPageError';
  }
}

/** The pdf.js module override is process-global; run it at most once. */
let pdfjsModuleReady: Promise<void> | null = null;

function ensurePdfjsModule(): Promise<void> {
  pdfjsModuleReady ??= definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
  return pdfjsModuleReady;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineNode[];
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** 2D matrix multiply in PDF [a,b,c,d,e,f] form (mirrors pdfjs Util.transform). */
export function multiplyMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * The subset of a pdfjs viewport needed to normalize text boxes. `transform`
 * maps PDF user space to rendered pixels (including the y-flip), while
 * `width`/`height` are the rendered pixel dimensions.
 */
export interface RenderViewport {
  transform: number[];
  width: number;
  height: number;
}

/**
 * Converts a page's text items into normalized boxes (0..1, y from the top)
 * so the client can position a selectable text layer over the frame at any size.
 * `viewport` must be the RENDER_SCALE viewport the frame was rasterized with.
 */
export function toTextBoxes(items: PdfTextItem[], viewport: RenderViewport): TextItemBox[] {
  const boxes: TextItemBox[] = [];
  for (const item of items) {
    if (!item.str || item.str.trim().length === 0) continue;
    const tx = multiplyMatrix(viewport.transform, item.transform);
    boxes.push({
      t: item.str,
      x: round(tx[4] / viewport.width),
      y: round((tx[5] - item.height * RENDER_SCALE) / viewport.height),
      w: round((item.width * RENDER_SCALE) / viewport.width),
      h: round((item.height * RENDER_SCALE) / viewport.height),
    });
  }
  return boxes;
}

@Injectable()
export class PdfConverter {
  private readonly logger = new Logger(PdfConverter.name);

  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  async convert(input: { bookId: string; contentVersion: number; buffer: Buffer }): Promise<ConvertedBook> {
    await ensurePdfjsModule();
    const doc = await getDocumentProxy(new Uint8Array(input.buffer), {
      wasmUrl: resolvePdfjsWasmUrl(),
      useWasm: true,
      useWorkerFetch: true,
    });
    const { OPS } = await getResolvedPDFJS();
    const pageCount = doc.numPages;
    const pages: ConvertedPage[] = [];
    let lastWidth = 0;
    let lastHeight = 0;

    for (let index = 1; index <= pageCount; index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const textContent = await page.getTextContent();
      const rawItems: PdfTextItem[] = [];
      for (const item of textContent.items) {
        if ('str' in item) {
          rawItems.push({ str: item.str, transform: item.transform, width: item.width, height: item.height });
        }
      }
      const boxes = toTextBoxes(rawItems, viewport);

      const image = await renderPageAsImage(doc, index, {
        scale: RENDER_SCALE,
        canvasImport: () => import('@napi-rs/canvas'),
      });
      await this.assertFrameHasContent(page, index, Buffer.from(image), OPS);

      const assetKey = `books/${input.bookId}/v${input.contentVersion}/pages/${index}.png`;
      const textKey = `books/${input.bookId}/v${input.contentVersion}/pages/${index}.json`;
      await this.storage.put(assetKey, Buffer.from(image), 'image/png');
      await this.storage.put(textKey, Buffer.from(JSON.stringify({ items: boxes })), 'application/json');

      lastWidth = Math.round(viewport.width);
      lastHeight = Math.round(viewport.height);
      pages.push({
        index,
        assetKey,
        textKey,
        mimeType: 'image/png',
        width: lastWidth,
        height: lastHeight,
        itemCount: boxes.length,
      });
    }

    const toc = await this.extractToc(doc);
    this.logger.log(`Converted PDF ${input.bookId}: ${pageCount} pages, ${toc.length} toc entries`);
    return { format: 'PDF', pageCount, pages, toc };
  }

  /**
   * Guards against pdf.js silently skipping a failed image decode: a page that
   * paints a raster image but rasterizes to uniform white is a converter error,
   * not a readable frame. Genuinely empty pages (no image paint operators) are
   * allowed to stay blank.
   */
  private async assertFrameHasContent(
    page: { getOperatorList(): Promise<{ fnArray: number[] }> },
    index: number,
    png: Buffer,
    ops: Record<string, number | undefined>,
  ): Promise<void> {
    let paintsImages: boolean;
    try {
      const operatorList = await page.getOperatorList();
      paintsImages = pagePaintsImages(operatorList.fnArray, ops);
    } catch (error) {
      // Without the operator list we cannot tell an image-only page from a text
      // page; log rather than fail, so a transient extraction glitch does not
      // reject an otherwise fine conversion.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not inspect page ${index} content; skipping blank-frame check: ${message}`);
      return;
    }
    if (!paintsImages) return;

    const stats = await measureFramePng(png);
    if (isNearUniformWhite(stats)) throw new BlankPageError(index, stats);
  }

  private async extractToc(doc: PdfDocument): Promise<ConvertedTocEntry[]> {
    const fallback: ConvertedTocEntry[] = [{ title: 'Page 1', page: 1, depth: 0, order: 0 }];
    const outline = (await doc.getOutline()) as PdfOutlineNode[] | null;
    if (!outline?.length) return fallback;

    const entries: ConvertedTocEntry[] = [];
    const visit = async (nodes: PdfOutlineNode[], depth: number): Promise<void> => {
      for (const node of nodes) {
        const page = await this.resolveDestPage(doc, node.dest);
        if (page !== null) entries.push({ title: node.title, page, depth, order: entries.length });
        if (node.items?.length) await visit(node.items, depth + 1);
      }
    };
    await visit(outline, 0);
    return entries.length > 0 ? entries : fallback;
  }

  private async resolveDestPage(doc: PdfDocument, dest: string | unknown[] | null): Promise<number | null> {
    if (!dest) return null;
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      const ref = explicit?.[0];
      if (!ref || typeof ref !== 'object') return null;
      const pageIndex = await doc.getPageIndex(ref as never);
      return pageIndex + 1;
    } catch {
      return null;
    }
  }
}
