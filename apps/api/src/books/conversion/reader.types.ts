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
