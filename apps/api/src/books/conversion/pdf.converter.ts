import { Inject, Injectable, Logger } from '@nestjs/common';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { STORAGE_ADAPTER, StorageAdapter } from '../../storage/storage-adapter.js';
import { ConvertedBook, ConvertedPage, ConvertedTocEntry, TextItemBox } from './reader.types.js';

export const RENDER_SCALE = 2;

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
    const doc = await getDocumentProxy(new Uint8Array(input.buffer));
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
