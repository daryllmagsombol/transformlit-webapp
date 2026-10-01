export interface TextItemBox {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ConvertedPage {
  index: number;
  assetKey: string;
  textKey: string;
  mimeType: string;
  width: number;
  height: number;
  itemCount: number;
  frameByteLength: number;
  frameSha256: string;
  textByteLength: number;
  textSha256: string;
  charCount: number;
  /** True when the page has a text layer (possibly legitimately empty). */
  hasTextLayer: boolean;
}

export interface ConvertedTocEntry {
  title: string;
  page: number;
  depth: number;
  order: number;
}

export interface ConvertedBook {
  format: 'PDF';
  pageCount: number;
  pages: ConvertedPage[];
  toc: ConvertedTocEntry[];
}
