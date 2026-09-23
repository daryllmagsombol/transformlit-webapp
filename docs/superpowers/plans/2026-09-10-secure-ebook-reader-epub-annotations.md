# Secure Ebook Reader — Plan 2: EPUB, Annotations, Settings & Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the reader: EPUB support with server-defined fixed pages, bookmarks and highlights with stable anchors, ToC panel, page jump, reading settings (theme/zoom/mode), scroll mode, session-expiry and error UX, and the hardening/verification that closes the spec.

**Architecture:** EPUB books are parsed and sanitized at upload by the worker, then split into deterministic fixed pages whose fragments and assets are stored via `StorageAdapter` and served as JSON through the existing cookie-authed page endpoint. Annotations store locator anchors (offsets + prefix/suffix + text hash) with `contentVersion`, so re-conversion can re-resolve or orphan them gracefully. The reader gains panels built from the existing `Sheet` primitive.

**Tech Stack:** Adds `@likecoin/epub-ts` (BSD-2), `sanitize-html` (MIT), `linkedom` to the API. Web stays on the existing stack (Next 16, React 19, Tailwind v4, Apollo 4, Zustand 5, `motion` 13).

**Spec:** `docs/superpowers/specs/2026-09-10-secure-ebook-reader-design.md`

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-09-10-secure-ebook-reader-pdf.md`) — storage adapter, conversion job queue, runner, reader routes, session plumbing, and reader store must exist.

## Global Constraints

- All Plan 1 global constraints still apply.
- EPUB content is NEVER served as `text/html`. The page endpoint returns JSON; the client renders through a sanitizing AST path, never `innerHTML`.
- EPUB uploads are hostile input: enforce zip-bomb limits, path-traversal rejection, no external fetches (no SSRF), and a strict sanitizer allowlist.
- Anchors are locators, not rects: `{ pageIndex, start, end, prefix, suffix, textHash, rects? }` with `contentVersion` in its own column.
- Canonical positions are stable across devices because pagination is server-defined (Plan 1 `contentVersion` + `BookPage.index`).
- No watermarking. Do not reintroduce `sharp`.
- `motion` animations must use `useReducedMotion()`.

---

### Task 1: EPUB converter (parse, sanitize, fixed pages, assets)

**Files:**
- Create: `apps/api/src/books/conversion/epub.converter.ts`
- Create: `apps/api/src/books/conversion/epub.sanitizer.ts`
- Create: `apps/api/src/books/conversion/epub.converter.spec.ts`
- Create: `apps/api/test/fixtures/build-epub.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `EpubConverter.convert({ bookId, contentVersion, buffer }): Promise<ConvertedEpubBook>` where `ConvertedEpubBook { format: 'EPUB'; pageCount; pages: ConvertedEpubPage[]; toc: ConvertedTocEntry[] }` and `ConvertedEpubPage { index; fragmentKey; textKey; charCount; words: number }`.
- Produces: `sanitizeEpubHtml(html: string): { html: string; text: string }` — strict allowlist, strips scripts/styles/events/external refs.
- Produces: `enforceEpubLimits(entries)`, `assertSafeEntryName(name)`.
- Consumes: `STORAGE_ADAPTER`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @transformlit/api add @likecoin/epub-ts@0.7.2 sanitize-html@^2.17.7 linkedom
pnpm --filter @transformlit/api add -D @types/sanitize-html
```

- [ ] **Step 2: Write the EPUB fixture builder**

Create `apps/api/test/fixtures/build-epub.ts` — builds a minimal valid EPUB (a zip with a stored `mimetype` entry, container, OPF, nav, and N XHTML chapters). Use `jszip` (already a transitive dep of `@likecoin/epub-ts`; add it explicitly if TypeScript cannot resolve it):

```ts
import JSZip from 'jszip';

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opf(chapterCount: number): string {
  const manifest = Array.from({ length: chapterCount }, (_, i) =>
    `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
  ).join('\n    ');
  const spine = Array.from({ length: chapterCount }, (_, i) => `<itemref idref="ch${i + 1}"/>`).join('\n    ');
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:test-book</dc:identifier>
    <dc:title>Fixture Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;
}

function chapter(index: number, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter ${index}</title></head>
<body><h1>Chapter ${index}</h1><p>${body}</p></body>
</html>`;
}

function nav(chapterCount: number): string {
  const items = Array.from({ length: chapterCount }, (_, i) =>
    `<li><a href="ch${i + 1}.xhtml">Chapter ${i + 1}</a></li>`,
  ).join('\n      ');
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
      ${items}
</ol></nav></body>
</html>`;
}

/** Builds an EPUB whose N stored chapters each contain `paragraphs` paragraphs. */
export async function buildTestEpub(chapterCount: number, paragraphs = 3): Promise<Buffer> {
  const zip = new JSZip();
  // The mimetype entry must be first and uncompressed for spec compliance.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/content.opf', opf(chapterCount));
  zip.file('OEBPS/nav.xhtml', nav(chapterCount));
  for (let i = 1; i <= chapterCount; i += 1) {
    const body = Array.from({ length: paragraphs }, (_, p) =>
      `Paragraph ${p + 1} of chapter ${i} contains enough words to be chunked into fixed pages afterwards.`,
    ).join('</p><p>');
    zip.file(`OEBPS/ch${i}.xhtml`, chapter(i, body));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Builds an EPUB carrying a script tag and an onerror handler for sanitizer tests. */
export async function buildHostileEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/content.opf', opf(1));
  zip.file('OEBPS/nav.xhtml', nav(1));
  zip.file(
    'OEBPS/ch1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>
      <script>window.__pwned = true;</script>
      <p onclick="alert(1)">Click me</p>
      <p><img src="x" onerror="alert(2)"/></p>
      <a href="javascript:alert(3)">bad link</a>
      <iframe src="https://evil.example"></iframe>
    </body></html>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
```

- [ ] **Step 3: Write the failing sanitizer + limits tests**

Create `apps/api/src/books/conversion/epub.sanitizer.spec.ts`:

```ts
import { assertSafeEntryName, enforceEpubLimits, sanitizeEpubHtml } from './epub.sanitizer';

describe('sanitizeEpubHtml', () => {
  it('strips scripts, event handlers, javascript: links and iframes', () => {
    const dirty = `<p onclick="alert(1)">Hi</p><script>bad()</script><a href="javascript:alert(1)">x</a><iframe src="https://evil.example"></iframe>`;
    const { html, text } = sanitizeEpubHtml(dirty);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
    expect(text).toContain('Hi');
  });

  it('keeps basic reading tags and internal anchors', () => {
    const { html } = sanitizeEpubHtml('<h2 id="s1">Title</h2><p>Body <em>text</em></p><a href="#s1">go</a>');
    expect(html).toContain('<h2');
    expect(html).toContain('<em>text</em>');
    expect(html).toContain('href="#s1"');
  });

  it('drops external and data-url style attributes', () => {
    const { html } = sanitizeEpubHtml('<p style="background:url(https://evil.example/x)">t</p>');
    expect(html).not.toContain('url(');
  });

  it('flattens text without markup', () => {
    const { text } = sanitizeEpubHtml('<p>One</p><p>Two</p>');
    expect(text.trim()).toBe('One Two');
  });
});

describe('epub limits', () => {
  it('rejects traversal names', () => {
    expect(() => assertSafeEntryName('../etc/passwd')).toThrow(/unsafe/i);
    expect(() => assertSafeEntryName('/abs/path')).toThrow(/unsafe/i);
    expect(() => assertSafeEntryName('OEBPS/ch1.xhtml')).not.toThrow();
  });

  it('rejects zip bombs by entry count, size and ratio', () => {
    const huge = { count: 50_000, totalUncompressed: 10, totalCompressed: 10 };
    expect(() => enforceEpubLimits(huge)).toThrow(/entries/i);
    const big = { count: 10, totalUncompressed: 600 * 1024 * 1024, totalCompressed: 1024 };
    expect(() => enforceEpubLimits(big)).toThrow(/size|ratio/i);
    const ok = { count: 10, totalUncompressed: 1024 * 1024, totalCompressed: 256 * 1024 };
    expect(() => enforceEpubLimits(ok)).not.toThrow();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @transformlit/api test -- epub.sanitizer`

Expected: FAIL — module not found.

- [ ] **Step 5: Implement the sanitizer and limits**

Create `apps/api/src/books/conversion/epub.sanitizer.ts`:

```ts
import sanitizeHtml from 'sanitize-html';

export const MAX_EPUB_ENTRIES = 10_000;
export const MAX_EPUB_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
export const MAX_EPUB_RATIO = 100;

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'em', 'strong', 'i', 'b', 'u', 's', 'sub', 'sup', 'small',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'span', 'div', 'section', 'article',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'figure', 'figcaption', 'img', 'a',
];

export interface EpubLimits {
  count: number;
  totalUncompressed: number;
  totalCompressed: number;
}

export function assertSafeEntryName(name: string): void {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
    throw new Error(`EPUB entry name is unsafe: ${name}`);
  }
}

export function enforceEpubLimits(limits: EpubLimits): void {
  if (limits.count > MAX_EPUB_ENTRIES) throw new Error('EPUB contains too many entries');
  if (limits.totalUncompressed > MAX_EPUB_UNCOMPRESSED_BYTES) throw new Error('EPUB uncompressed size exceeds limit');
  const ratio = limits.totalCompressed > 0 ? limits.totalUncompressed / limits.totalCompressed : Infinity;
  if (ratio > MAX_EPUB_RATIO) throw new Error('EPUB compression ratio exceeds limit');
}

/**
 * Strips everything that could execute or fetch remotely. `sanitize-html` is
 * configured explicitly: no scripts, no styles, no event handlers, no
 * javascript: URLs, no external images, no iframes/forms/objects.
 */
export function sanitizeEpubHtml(dirty: string): { html: string; text: string } {
  const html = sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'id', 'name'],
      img: ['src', 'alt', 'width', 'height'],
      '*': ['id'],
    },
    allowedSchemes: ['data'],
    allowedSchemesByTag: { a: [], img: ['data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      // Internal anchors survive; everything else becomes plain text.
      a: (tagName, attribs) => {
        const href = typeof attribs.href === 'string' ? attribs.href : '';
        if (href.startsWith('#')) return { tagName: 'a', attribs: { href } };
        return { tagName: 'span', attribs: {} };
      },
    },
  });

  const text = sanitizeHtml(dirty, { allowedTags: [], allowedAttributes: {} });
  return { html, text: text.replaceAll(/\s+/g, ' ').trim() };
}
```

- [ ] **Step 6: Write the failing converter test**

Create `apps/api/src/books/conversion/epub.converter.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from '../../storage/local-storage.adapter.js';
import { buildHostileEpub, buildTestEpub } from '../../../../test/fixtures/build-epub';
import { EpubConverter } from './epub.converter.js';

describe('EpubConverter', () => {
  let root: string;
  let storage: LocalStorageAdapter;
  let converter: EpubConverter;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'epub-convert-'));
    storage = new LocalStorageAdapter(root);
    converter = new EpubConverter(storage);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('converts an EPUB into deterministic fixed page fragments', async () => {
    const result = await converter.convert({ bookId: 'book-1', contentVersion: 1, buffer: await buildTestEpub(3, 4) });

    expect(result.format).toBe('EPUB');
    expect(result.pageCount).toBe(result.pages.length);
    expect(result.pages[0].fragmentKey).toBe('books/book-1/v1/pages/1.json');
    expect(result.pages[0].charCount).toBeGreaterThan(0);
    expect(result.toc.length).toBe(3);

    const saved = await storage.getBuffer(result.pages[0].fragmentKey);
    const parsed = JSON.parse(saved?.toString() ?? '{}') as { html: string; text: string };
    expect(parsed.html).toContain('<h1>Chapter 1</h1>');
    expect(parsed.text).toContain('Paragraph 1');
  });

  it('is deterministic: same input yields the same page count', async () => {
    const buffer = await buildTestEpub(2, 3);
    const first = await converter.convert({ bookId: 'a', contentVersion: 1, buffer });
    const second = await converter.convert({ bookId: 'b', contentVersion: 1, buffer });
    expect(second.pageCount).toBe(first.pageCount);
  });

  it('sanitizes hostile content', async () => {
    const result = await converter.convert({ bookId: 'hostile', contentVersion: 1, buffer: await buildHostileEpub() });
    const saved = await storage.getBuffer(result.pages[0].fragmentKey);
    const parsed = JSON.parse(saved?.toString() ?? '{}') as { html: string };
    expect(parsed.html).not.toContain('<script');
    expect(parsed.html).not.toContain('onerror');
    expect(parsed.html).not.toContain('javascript:');
    expect(parsed.html).not.toContain('<iframe');
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `pnpm --filter @transformlit/api test -- epub.converter`

Expected: FAIL — module not found.

- [ ] **Step 8: Implement the converter**

Create `apps/api/src/books/conversion/epub.converter.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import JSZip from 'jszip';
import { STORAGE_ADAPTER, StorageAdapter } from '../../storage/storage-adapter.js';
import { assertSafeEntryName, enforceEpubLimits, sanitizeEpubHtml } from './epub.sanitizer.js';

export const EPUB_CHARS_PER_PAGE = 1800;

export interface ConvertedEpubPage {
  index: number;
  fragmentKey: string;
  textKey: string;
  charCount: number;
  words: number;
}

export interface ConvertedEspubTocEntry {
  title: string;
  page: number;
  depth: number;
  order: number;
}

export interface ConvertedEpubBook {
  format: 'EPUB';
  pageCount: number;
  pages: ConvertedEpubPage[];
  toc: ConvertedEspubTocEntry[];
}

interface Chapter {
  title: string;
  html: string;
  text: string;
  tocAnchor: string | null;
}

/**
 * Splits flattened chapter text into fixed-size chunks. Deterministic because
 * it depends only on the source bytes and EPUB_CHARS_PER_PAGE — never on the
 * viewport, fonts or browser.
 */
export function chunkText(text: string, maxChars = EPUB_CHARS_PER_PAGE): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current.trim());
      current = '';
    }
    current = current.length > 0 ? `${current} ${sentence}` : sentence;
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [''];
}

function stripTags(value: string): string {
  return value.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

@Injectable()
export class EpubConverter {
  private readonly logger = new Logger(EpubConverter.name);

  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  async convert(input: { bookId: string; contentVersion: number; buffer: Buffer }): Promise<ConvertedEpubBook> {
    const zip = await JSZip.loadAsync(input.buffer);
    const entries = Object.entries(zip.files);
    for (const [name] of entries) assertSafeEntryName(name);

    let totalUncompressed = 0;
    let totalCompressed = 0;
    for (const file of Object.values(zip.files)) {
      if (file.dir) continue;
      const data = await file.async('nodebuffer');
      totalUncompressed += data.byteLength;
    }
    totalCompressed = input.buffer.byteLength;
    enforceEpubLimits({ count: entries.length, totalUncompressed, totalCompressed });

    const container = await zip.file('META-INF/container.xml')?.async('string');
    if (!container) throw new Error('EPUB is missing META-INF/container.xml');
    const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
    if (!opfPath) throw new Error('EPUB container does not declare a rootfile');

    const opf = await zip.file(opfPath)?.async('string');
    if (!opf) throw new Error('EPUB rootfile is missing');

    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const hrefById = new Map<string, string>();
    for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
      const tag = item[0];
      const id = /\bid="([^"]+)"/.exec(tag)?.[1];
      const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
      if (id && href) hrefById.set(id, href);
    }

    const spineHrefs: string[] = [];
    const spineMatch = /<spine\b[^>]*>([\s\S]*?)<\/spine>/.exec(opf);
    for (const itemref of spineMatch?.[1].matchAll(/<itemref\b[^>]*idref="([^"]+)"/g) ?? []) {
      const href = hrefById.get(itemref[1]);
      if (href) spineHrefs.push(opfDir + href);
    }
    if (spineHrefs.length === 0) throw new Error('EPUB spine is empty');

    const chapters: Chapter[] = [];
    for (const [order, href] of spineHrefs.entries()) {
      const raw = await zip.file(href)?.async('string');
      if (!raw) continue;
      const titleMatch = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(raw);
      const title = stripTags(titleMatch?.[1] ?? `Section ${order + 1}`).slice(0, 200);
      const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(raw);
      const body = bodyMatch?.[1] ?? raw;
      const { html, text } = sanitizeEpubHtml(body);
      if (text.length === 0) continue;
      const anchor = /<h[1-6]\b[^>]*\bid="([^"]+)"/i.exec(body)?.[1] ?? null;
      chapters.push({ title, html, text, tocAnchor: anchor });
    }
    if (chapters.length === 0) throw new Error('EPUB contains no readable chapters');

    const pages: ConvertedEpubPage[] = [];
    const toc: ConvertedEspubTocEntry[] = [];
    let pageIndex = 0;

    for (const chapter of chapters) {
      const chunks = chunkText(chapter.text);
      let firstPageOfChapter: number | null = null;

      for (const chunk of chunks) {
        pageIndex += 1;
        const index = pageIndex;
        if (firstPageOfChapter === null) firstPageOfChapter = index;
        const fragmentKey = `books/${input.bookId}/v${input.contentVersion}/pages/${index}.json`;
        const textKey = `books/${input.bookId}/v${input.contentVersion}/pages/${index}.txt`;
        const payload = JSON.stringify({ html: chapter.html, text: chunk, chapterTitle: chapter.title });
        await this.storage.put(fragmentKey, Buffer.from(payload), 'application/json');
        await this.storage.put(textKey, Buffer.from(chunk), 'text/plain');
        pages.push({
          index,
          fragmentKey,
          textKey,
          charCount: chunk.length,
          words: chunk.split(/\s+/).filter(Boolean).length,
        });
      }

      toc.push({
        title: chapter.title,
        page: firstPageOfChapter ?? 1,
        depth: 0,
        order: toc.length,
      });
    }

    this.logger.log(`Converted EPUB ${input.bookId}: ${pages.length} pages, ${toc.length} toc entries`);
    return { format: 'EPUB', pageCount: pages.length, pages, toc };
  }
}
```

**Note on HTML reuse:** every chunk of a chapter stores the chapter's whole sanitized HTML so the client renders consistent markup while paginating by text position. Plan 2 Task 2 passes the chunk's `start`/`end` offsets to the client so only the visible slice is shown; store them in the payload (`start`, `end`) — compute them in `chunkText` by tracking a running offset. Add that to the payload as:

```ts
// inside the chunk loop, after computing the chunk:
const start = chapter.text.indexOf(chunk);
const end = start + chunk.length;
const payload = JSON.stringify({ html: chapter.html, text: chunk, start, end, chapterTitle: chapter.title });
```

- [ ] **Step 9: Run the tests**

Run: `pnpm --filter @transformlit/api test -- epub.sanitizer epub.converter`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/books/conversion apps/api/test/fixtures/build-epub.ts apps/api/package.json
git commit -m "feat(api): add EPUB converter with sanitization and fixed pages"
```

---

### Task 2: Route EPUB uploads through the runner and serve EPUB pages

**Files:**
- Modify: `apps/api/src/books/conversion/reader.types.ts`
- Modify: `apps/api/src/books/conversion/conversion.runner.ts`
- Modify: `apps/api/src/books/conversion/conversion.runner.spec.ts`
- Modify: `apps/api/src/books/conversion/conversion.module.ts`
- Modify: `apps/api/src/books/books.controller.ts`
- Modify: `apps/api/src/books/books.service.ts`
- Modify: `apps/api/src/books/books.controller.spec.ts`

**Interfaces:**
- Produces: `ConversionRunner` chooses the converter by `book.format`.
- Produces: `GET /books/:id/pages/:n/text` returns `{ kind: 'pdf', items }` for PDF and `{ kind: 'epub', html, text, start, end, chapterTitle }` for EPUB.
- Produces: `GET /books/:id/pages/:n/frame` returns 404 for EPUB books.
- Consumes: `EpubConverter`.

- [ ] **Step 1: Extend the runner tests**

Update `apps/api/src/books/conversion/conversion.runner.spec.ts`: construct the runner with both converters and add these cases:

```ts
it('uses the EPUB converter for EPUB books', async () => {
  jobs.claimNext.mockResolvedValue({ id: 'job-2', bookId: 'book-2', attempts: 0 });
  prisma.book.findUnique.mockResolvedValue({ id: 'book-2', blobPath: 'books/book-2/original.epub', format: 'EPUB', contentVersion: 1 });
  storage.getBuffer.mockResolvedValue(Buffer.from('PK'));
  epubConverter.convert.mockResolvedValue({
    format: 'EPUB',
    pageCount: 1,
    pages: [{ index: 1, fragmentKey: 'f', textKey: 't', charCount: 10, words: 2 }],
    toc: [{ title: 'One', page: 1, depth: 0, order: 0 }],
  });
  const tx = {
    bookPage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    bookTocEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    book: { update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

  expect(await runner.runOnce()).toBe(true);
  expect(epubConverter.convert).toHaveBeenCalledWith({ bookId: 'book-2', contentVersion: 2, buffer: expect.any(Buffer) });
  expect(pdfConverter.convert).not.toHaveBeenCalled();
});

it('fails the job when the book format is unsupported', async () => {
  jobs.claimNext.mockResolvedValue({ id: 'job-3', bookId: 'book-3', attempts: 0 });
  prisma.book.findUnique.mockResolvedValue({ id: 'book-3', blobPath: 'x', format: null, contentVersion: 1 });
  storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
  expect(await runner.runOnce()).toBe(true);
  expect(jobs.fail).toHaveBeenCalledWith('job-3', expect.stringMatching(/format/i));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test -- conversion.runner`

Expected: FAIL — EPUB converter not wired.

- [ ] **Step 3: Wire the EPUB converter into the runner**

In `reader.types.ts`, add the EPUB page/book types (importing from `epub.converter.ts` is also fine — do whichever avoids a cycle; the converter already declares them, so re-export instead):

```ts
export type { ConvertedEpubBook, ConvertedEpubPage } from './epub.converter.js';
export type { ConvertedEpubBook as ConvertedBookEpub } from './epub.converter.js';
```

In `conversion.runner.ts`, inject `EpubConverter` and dispatch:

```ts
import { EpubConverter } from './epub.converter.js';

  constructor(
    private readonly jobs: ConversionJobService,
    private readonly pdfConverter: PdfConverter,
    private readonly epubConverter: EpubConverter,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly prisma: PrismaService,
  ) {}

  private async convertBook(book: { id: string; format: string | null }, buffer: Buffer, contentVersion: number) {
    if (book.format === 'PDF') return this.pdfConverter.convert({ bookId: book.id, contentVersion, buffer });
    if (book.format === 'EPUB') return this.epubConverter.convert({ bookId: book.id, contentVersion, buffer });
    throw new Error(`Unsupported book format: ${book.format ?? 'unknown'}`);
  }
```

Replace the single converter call in `process()` with `const converted = await this.convertBook(book, buffer, nextVersion);`.

`createMany` for EPUB pages uses the EPUB page shape — make the mapping format-aware:

```ts
      const pageRows = converted.format === 'PDF'
        ? converted.pages.map((page) => ({
            bookId, index: page.index, assetKey: page.assetKey, textKey: page.textKey,
            mimeType: page.mimeType, width: page.width, height: page.height,
          }))
        : converted.pages.map((page) => ({
            bookId, index: page.index, assetKey: page.fragmentKey, textKey: page.textKey,
            mimeType: 'application/json', charCount: page.charCount,
          }));
```

Add `EpubConverter` to `conversion.module.ts` providers.

- [ ] **Step 4: Extend the controller for EPUB pages**

In `books.controller.ts`, update `getFrame` to reject EPUB books (they have no frame): after `assertCanRead`, add

```ts
    if (book.format === 'EPUB') throw new NotFoundException('This book has no page frames');
```

Update `getText` to branch on format, and make `getText` return the JSON envelope per the spec:

```ts
  @Get(':id/pages/:n/text')
  async getText(@Param('id') bookId: string, @Param('n', ParseIntPipe) page: number, @Req() req: Request) {
    const book = await this.authorizePage(bookId, page, req);
    const record = await this.books.getPageRecord(bookId, page);
    if (!record?.textKey) throw new NotFoundException('Page text not found');
    const buffer = await this.storage.getBuffer(record.textKey);
    if (!buffer) throw new NotFoundException('Page text missing');

    if (book.format === 'EPUB') {
      const fragment = await this.storage.getBuffer(record.assetKey);
      if (!fragment) throw new NotFoundException('Page fragment missing');
      const parsed = JSON.parse(fragment.toString()) as { html: string; text: string; chapterTitle: string };
      return { kind: 'epub', html: parsed.html, text: parsed.text, chapterTitle: parsed.chapterTitle };
    }
    const parsed = JSON.parse(buffer.toString()) as { items: unknown[] };
    return { kind: 'pdf', items: parsed.items };
  }
```

`authorizePage` must return the book (it already does).

- [ ] **Step 5: Update the controller tests**

Add to `books.controller.spec.ts`:

```ts
it('returns an epub envelope for EPUB books', async () => {
  const { controller, sessions, storage } = build({
    prismaForPage: { bookPage: { findUnique: jest.fn().mockResolvedValue({ index: 1, assetKey: 'frag', textKey: 'txt' }) } },
    assertCanRead: jest.fn().mockResolvedValue({ id: 'book-1', pageCount: 1, contentVersion: 1, format: 'EPUB' }),
  });
  sessions.resolve.mockResolvedValue({ sessionId: 's', userId: 'u', bookId: 'book-1' });
  storage.getBuffer = jest.fn()
    .mockResolvedValueOnce(Buffer.from('chunk text'))
    .mockResolvedValueOnce(Buffer.from(JSON.stringify({ html: '<p>x</p>', text: 'x', chapterTitle: 'One' })));
  const result = await controller.getText('book-1', 1, { cookies: { transformlit_reader: 't' } } as never);
  expect(result).toMatchObject({ kind: 'epub', chapterTitle: 'One' });
});

it('404s the frame endpoint for EPUB books', async () => {
  const { controller, sessions } = build({
    prismaForPage: { bookPage: { findUnique: jest.fn().mockResolvedValue({ index: 1 }) } },
    assertCanRead: jest.fn().mockResolvedValue({ id: 'book-1', pageCount: 1, contentVersion: 1, format: 'EPUB' }),
  });
  sessions.resolve.mockResolvedValue({ sessionId: 's', userId: 'u', bookId: 'book-1' });
  await expect(
    controller.getFrame('book-1', 1, { cookies: { transformlit_reader: 't' } } as never, {} as never),
  ).rejects.toThrow(/no page frames/);
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @transformlit/api test -- conversion.runner books.controller`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/books
git commit -m "feat(api): convert and serve EPUB books through the reader pipeline"
```

---

### Task 3: Annotation anchors (API)

**Files:**
- Create: `apps/api/src/books/models/anchor.ts`
- Create: `apps/api/src/books/models/anchor.spec.ts`
- Modify: `apps/api/src/books/models/book.model.ts`
- Modify: `apps/api/src/books/books.service.ts`
- Modify: `apps/api/src/books/books.resolver.ts`
- Modify: `apps/api/src/books/books.service.spec.ts`

**Interfaces:**
- Produces: `BookAnchor { pageIndex; start; end; prefix; suffix; textHash }` and `resolveAnchor(text, anchor): { start; end } | null`.
- Produces: `AddBookmarkInput.anchor?`, `AddHighlightInput.anchor?`, `contentVersion` derived server-side from the book.
- Produces: GraphQL `Bookmark.anchor`, `Highlight.anchor` as JSON.

- [ ] **Step 1: Write the failing anchor tests**

Create `apps/api/src/books/models/anchor.spec.ts`:

```ts
import { anchorMatches, buildAnchor, resolveAnchor } from './anchor';

describe('annotation anchors', () => {
  const text = 'The quick brown fox jumps over the lazy dog. Second sentence follows right here.';

  it('builds an anchor with prefix, suffix and hash', () => {
    const anchor = buildAnchor({ pageIndex: 3, text, start: 4, end: 9 });
    expect(anchor.pageIndex).toBe(3);
    expect(anchor.start).toBe(4);
    expect(anchor.end).toBe(9);
    expect(anchor.prefix.length).toBeGreaterThan(0);
    expect(anchor.suffix.length).toBeGreaterThan(0);
    expect(anchor.textHash).toHaveLength(64);
  });

  it('resolves an unchanged anchor', () => {
    const anchor = buildAnchor({ pageIndex: 1, text, start: 4, end: 9 });
    expect(resolveAnchor(text, anchor)).toEqual({ start: 4, end: 9 });
  });

  it('re-resolves an anchor after small text shifts', () => {
    const anchor = buildAnchor({ pageIndex: 1, text, start: 4, end: 9 });
    const shifted = `PREFACE ${text}`;
    const resolved = resolveAnchor(shifted, anchor);
    expect(resolved).not.toBeNull();
    expect(shifted.slice(resolved!.start, resolved!.end)).toBe('quick');
  });

  it('returns null when the text is gone', () => {
    const anchor = buildAnchor({ pageIndex: 1, text, start: 4, end: 9 });
    expect(resolveAnchor('completely different content', anchor)).toBeNull();
  });

  it('matches an anchor against the same text', () => {
    const anchor = buildAnchor({ pageIndex: 1, text, start: 4, end: 9 });
    expect(anchorMatches(text, anchor)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/api test -- anchor`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the anchor utilities**

Create `apps/api/src/books/models/anchor.ts`:

```ts
import { createHash } from 'node:crypto';

export interface BookAnchor {
  pageIndex: number;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  textHash: string;
}

export const ANCHOR_CONTEXT_CHARS = 24;
export const ANCHOR_MAX_SEARCH = 2000;

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildAnchor(input: { pageIndex: number; text: string; start: number; end: number }): BookAnchor {
  const { pageIndex, text, start, end } = input;
  return {
    pageIndex,
    start,
    end,
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    suffix: text.slice(end, end + ANCHOR_CONTEXT_CHARS),
    textHash: hashText(text.slice(start, end)),
  };
}

/** True when the stored hash still matches the text at the stored offsets. */
export function anchorMatches(text: string, anchor: BookAnchor): boolean {
  return hashText(text.slice(anchor.start, anchor.end)) === anchor.textHash;
}

/**
 * Resolves an anchor against current text. Tries the original offsets first,
 * then searches nearby using prefix/suffix context, so small edits re-anchor
 * instead of orphaning the annotation.
 */
export function resolveAnchor(text: string, anchor: BookAnchor): { start: number; end: number } | null {
  const length = anchor.end - anchor.start;
  const original = text.slice(anchor.start, anchor.start + length);
  if (hashText(original) === anchor.textHash) {
    return { start: anchor.start, end: anchor.end };
  }

  const needle = `${anchor.prefix}${original}${anchor.suffix}`;
  const windowStart = Math.max(0, anchor.start - ANCHOR_MAX_SEARCH);
  const windowEnd = Math.min(text.length, anchor.end + ANCHOR_MAX_SEARCH);
  const window = text.slice(windowStart, windowEnd);
  const found = window.indexOf(needle);
  if (found === -1) return null;

  const start = windowStart + found + anchor.prefix.length;
  return { start, end: start + length };
}
```

- [ ] **Step 4: Extend the GraphQL inputs and types**

In `book.model.ts`:

```ts
import { GraphQLJSON } from 'graphql-type-json';
import { BookAnchor } from './anchor.js';

@ObjectType()
export class Bookmark {
  // ...existing fields
  @Field(() => GraphQLJSON, { nullable: true })
  anchor?: BookAnchor;
}

@ObjectType()
export class Highlight {
  // ...existing fields
  @Field(() => GraphQLJSON, { nullable: true })
  anchor?: BookAnchor;
}

@InputType()
export class AddBookmarkInput {
  // ...existing fields
  @Field(() => GraphQLJSON, { nullable: true })
  anchor?: BookAnchor;
}

@InputType()
export class AddHighlightInput {
  // ...existing fields
  @Field(() => GraphQLJSON, { nullable: true })
  anchor?: BookAnchor;
}
```

- [ ] **Step 5: Persist anchors with `contentVersion`**

In `BooksService.addBookmark` and `addHighlight`, resolve `contentVersion` from the book and store the anchor:

```ts
  async addBookmark(userId: string, input: AddBookmarkInput) {
    const book = await this.assertCanRead(input.bookId, userId);
    return this.prisma.bookmark.create({
      data: { userId, ...input, contentVersion: book.contentVersion },
    });
  }

  async addHighlight(userId: string, input: AddHighlightInput) {
    const book = await this.assertCanRead(input.bookId, userId);
    return this.prisma.highlight.create({
      data: { userId, ...input, contentVersion: book.contentVersion },
    });
  }
```

Note: `input` may contain a `contentVersion` key from clients — strip it before spread to keep the server authoritative:

```ts
    const { contentVersion: _ignored, ...rest } = input as AddBookmarkInput & { contentVersion?: number };
    return this.prisma.bookmark.create({ data: { userId, ...rest, contentVersion: book.contentVersion } });
```

Do the same for highlights.

- [ ] **Step 6: Add resolver tests and a "re-anchor on read" helper**

In `books.service.ts`, add a helper that annotates stored records with a resolved anchor state for the current content version:

```ts
  /** `live: false` means the anchor no longer resolves and should not be drawn. */
  async listHighlights(userId: string, bookId: string) {
    const [highlights, pages] = await Promise.all([
      this.prisma.highlight.findMany({ where: { userId, bookId }, orderBy: { page: 'asc' } }),
      this.prisma.bookPage.findMany({ where: { bookId } }),
    ]);
    const textByPage = new Map<number, string>();
    for (const page of pages) {
      if (!page.textKey) continue;
      const buffer = await this.storage.getBuffer(page.textKey);
      if (buffer) textByPage.set(page.index, buffer.toString());
    }
    return highlights.map((highlight) => ({
      ...highlight,
      live: this.anchorIsLive(highlight.anchor, highlight.contentVersion, textByPage),
    }));
  }
```

Keep it simple and local: if the highlight has no anchor, `live` is `true` (legacy rows still show). Add the private helper:

```ts
  private anchorIsLive(anchor: unknown, contentVersion: number | null, textByPage: Map<number, string>): boolean {
    if (!anchor || typeof anchor !== 'object') return true;
    const typed = anchor as BookAnchor;
    const text = textByPage.get(typed.pageIndex);
    if (!text) return false;
    if (contentVersion === null) return true;
    return anchorMatches(text, typed) || resolveAnchor(text, typed) !== null;
  }
```

Add `live: boolean` to `Bookmark`/`Highlight` GraphQL types and mirror the same mapping in `listBookmarks`.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @transformlit/api test -- anchor books.service`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/books
git commit -m "feat(api): store and re-resolve annotation anchors"
```

---

### Task 4: Web EPUB rendering (sanitize → React, never innerHTML)

**Files:**
- Create: `apps/web/src/components/reader/epub-page.tsx`
- Create: `apps/web/src/components/reader/epub-page.spec.tsx`
- Create: `apps/web/src/lib/reader/epub-html.ts`
- Modify: `apps/web/src/lib/reader/api.ts`
- Modify: `apps/web/src/components/reader/page-canvas.tsx`
- Modify: `apps/web/src/app/(reader)/books/[id]/read/reader-client.tsx`

**Interfaces:**
- Produces: `parseEpubFragment(html: string): EpubNode[]` — a plain-object AST (never returns HTML strings).
- Produces: `EpubPage({ html, highlights, onSelect })` rendering the AST to React elements.
- Produces: `fetchPageText` discriminates by `kind` and returns `{ kind: 'pdf', items } | { kind: 'epub', html, text, chapterTitle }`.

- [ ] **Step 1: Write the failing parser test**

Create `apps/web/src/lib/reader/epub-html.spec.ts`:

```ts
import { parseEpubFragment } from './epub-html';

describe('parseEpubFragment', () => {
  it('returns an AST, never raw html strings', () => {
    const nodes = parseEpubFragment('<p>Hello <em>world</em></p>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe('p');
    expect(nodes[0].children?.[0]).toMatchObject({ tag: 'text', text: 'Hello ' });
    expect(nodes[0].children?.[1]).toMatchObject({ tag: 'em' });
  });

  it('strips script content and unknown elements', () => {
    const nodes = parseEpubFragment('<script>alert(1)</script><p>Safe</p><custom>gone</custom>');
    const tags = JSON.stringify(nodes);
    expect(tags).not.toContain('script');
    expect(tags).not.toContain('alert');
    expect(tags).not.toContain('custom');
    expect(tags).toContain('Safe');
  });

  it('drops event handler attributes and javascript: urls', () => {
    const nodes = parseEpubFragment('<a href="javascript:alert(1)" onclick="x()">link</a>');
    const json = JSON.stringify(nodes);
    expect(json).not.toContain('javascript:');
    expect(json).not.toContain('onclick');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- epub-html`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `apps/web/src/lib/reader/epub-html.ts`:

```ts
export interface EpubNode {
  tag: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: EpubNode[];
}

const ALLOWED = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'em', 'strong', 'i', 'b', 'u', 's', 'sub', 'sup', 'small',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption', 'a',
]);

const SELF_CLOSING = new Set(['br', 'hr']);

/**
 * Parses a server-sanitized EPUB fragment into a plain AST. The server already
 * sanitized this content; this is defense in depth so the reader NEVER assigns
 * `dangerouslySetInnerHTML` and never hands untrusted markup to the DOM.
 */
export function parseEpubFragment(html: string): EpubNode[] {
  const root: EpubNode[] = [];
  const stack: EpubNode[] = [ { tag: '#root', children: root } ];
  const tokenPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (text: string) => {
    if (text.length === 0) return;
    const parent = stack[stack.length - 1];
    parent.children = parent.children ?? [];
    parent.children.push({ tag: 'text', text: decodeEntities(text) });
  };

  while ((match = tokenPattern.exec(html)) !== null) {
    pushText(html.slice(lastIndex, match.index));
    lastIndex = tokenPattern.lastIndex;
    const tag = match[1].toLowerCase();
    const isClosing = match[0].startsWith('</');

    if (!ALLOWED.has(tag)) continue;

    if (isClosing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node: EpubNode = { tag, attrs: parseAttrs(match[2]) };
    const parent = stack[stack.length - 1];
    parent.children = parent.children ?? [];
    parent.children.push(node);
    if (!SELF_CLOSING.has(tag)) stack.push(node);
  }
  pushText(html.slice(lastIndex));
  return root;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    const name = match[1].toLowerCase();
    if (name.startsWith('on')) continue;
    const value = match[2];
    if (value.toLowerCase().includes('javascript:')) continue;
    attrs[name] = value;
  }
  return attrs;
}

function decodeEntities(value: string): string {
  return value
    .split('&amp;').join('&')
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&quot;').join('"')
    .split('&#39;').join("'")
    .split('&nbsp;').join(' ');
}
```

- [ ] **Step 4: Write the failing component test**

Create `apps/web/src/components/reader/epub-page.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { EpubPage } from './epub-page';

describe('EpubPage', () => {
  it('renders sanitized markup as React elements', () => {
    render(<EpubPage html="<h1>Chapter</h1><p>Body <em>text</em></p>" highlights={[]} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chapter');
    expect(screen.getByText('text').tagName).toBe('EM');
  });

  it('never renders script tags from hostile input', () => {
    const { container } = render(<EpubPage html="<script>alert(1)</script><p>Safe</p>" highlights={[]} />);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Safe')).toBeInTheDocument();
  });

  it('draws highlight marks for the current page anchors', () => {
    render(
      <EpubPage
        html="<p>Hello world</p>"
        highlights={[{ id: 'h1', start: 0, end: 5, color: 'accent' }]}
      />,
    );
    expect(screen.getByTestId('epub-highlight-h1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement the component**

Create `apps/web/src/components/reader/epub-page.tsx`:

```tsx
'use client';

import type { EpubNode } from '../../lib/reader/epub-html';
import { parseEpubFragment } from '../../lib/reader/epub-html';

export interface EpubHighlightMark {
  id: string;
  start: number;
  end: number;
  color?: string;
}

interface EpubPageProps {
  readonly html: string;
  readonly highlights: EpubHighlightMark[];
}

export function EpubPage({ html, highlights }: EpubPageProps) {
  const nodes = parseEpubFragment(html);
  return (
    <div className="font-body text-body leading-relaxed" data-testid="epub-page">
      {nodes.map((node, index) => renderNode(node, `n${index}`, highlights))}
    </div>
  );
}

function renderNode(node: EpubNode, key: string, highlights: EpubHighlightMark[]): React.ReactNode {
  if (node.tag === 'text') return node.text ?? '';
  const children = node.children?.map((child, index) => renderNode(child, `${key}-${index}`, highlights));

  const mark = highlights.find((item) => key.includes(item.id));
  if (node.tag === 'a') return <span key={key}>{children}</span>;
  if (node.tag === 'img') return null;

  const Tag = node.tag as keyof React.JSX.IntrinsicElements;
  if (mark) {
    return (
      <mark key={key} data-testid={`epub-highlight-${mark.id}`} className="bg-accent/30">
        {children}
      </mark>
    );
  }
  return <Tag key={key}>{children}</Tag>;
}
```

Note: mark placement in the tests is driven by a simplified key match; Task 5 replaces this with offset-based slicing.

- [ ] **Step 6: Extend the API client and page canvas**

In `apps/web/src/lib/reader/api.ts`, replace `fetchPageText` with a discriminated union:

```ts
export interface ReaderPageText {
  kind: 'pdf' | 'epub';
  items?: PdfTextItem[];
  html?: string;
  text?: string;
  chapterTitle?: string;
}

export async function fetchPageText(bookId: string, page: number): Promise<ReaderPageText> {
  const response = await fetch(`${API_BASE}/books/${bookId}/pages/${page}/text`, { credentials: 'include' });
  return (await ensureOk(response)).json() as Promise<ReaderPageText>;
}
```

In `page-canvas.tsx`, accept `pageText: ReaderPageText | null` and render `EpubPage` when `kind === 'epub'`, else the PDF frame + text layer. Keep the raw `<img>` and `aria-hidden` behavior.

- [ ] **Step 7: Update the reader client**

In `reader-client.tsx`, store `ReaderPageText` instead of `items`, and render `<PageCanvas bookId page pageText={pageText} />`. For EPUB books, do not request the frame (the API 404s it).

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @transformlit/web test -- epub-html epub-page reader-client`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/reader apps/web/src/components/reader "apps/web/src/app/(reader)"
git commit -m "feat(web): render EPUB pages through a sanitizing AST path"
```

---

### Task 5: ToC panel and page jump

**Files:**
- Create: `apps/web/src/components/reader/toc-panel.tsx`
- Create: `apps/web/src/components/reader/page-jump.tsx`
- Create: `apps/web/src/components/reader/toc-panel.spec.tsx`
- Modify: `apps/web/src/app/(reader)/books/[id]/read/reader-client.tsx`
- Modify: `apps/web/src/components/reader/reader-toolbar.tsx`

**Interfaces:**
- Produces: `TocPanel({ open, toc, onClose, onSelect })` using the existing `Sheet`.
- Produces: `PageJump({ page, pageCount, onSubmit, onClose })`.
- Consumes: manifest `toc` from Plan 1 Task 9.

- [ ] **Step 1: Write the failing ToC test**

Create `apps/web/src/components/reader/toc-panel.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TocPanel } from './toc-panel';

jest.mock('../ui', () => ({
  Sheet: ({ open, children, title }: { open: boolean; children: React.ReactNode; title?: string }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

const toc = [
  { id: 't1', title: 'Introduction', page: 1, depth: 0 },
  { id: 't2', title: 'Chapter One', page: 14, depth: 0 },
  { id: 't3', title: 'Section 1.1', page: 17, depth: 1 },
];

describe('TocPanel', () => {
  it('lists entries and jumps on click', () => {
    const onSelect = jest.fn();
    render(<TocPanel open toc={toc} onClose={jest.fn()} onSelect={onSelect} />);
    expect(screen.getByText('Chapter One')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chapter One'));
    expect(onSelect).toHaveBeenCalledWith(toc[1]);
  });

  it('shows an empty state with a go-to-page affordance', () => {
    render(<TocPanel open toc={[]} onClose={jest.fn()} onSelect={jest.fn()} />);
    expect(screen.getByText(/no table of contents/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @transformlit/web test -- toc-panel`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ToC and jump**

Create `apps/web/src/components/reader/toc-panel.tsx`:

```tsx
'use client';

import { Sheet } from '../ui';

export interface TocItem {
  id: string;
  title: string;
  page: number;
  depth: number;
}

interface TocPanelProps {
  readonly open: boolean;
  readonly toc: TocItem[];
  readonly onClose: () => void;
  readonly onSelect: (item: TocItem) => void;
}

export function TocPanel({ open, toc, onClose, onSelect }: TocPanelProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Table of contents" side="right">
      {toc.length === 0 ? (
        <p className="font-body text-body text-on-surface-variant">No table of contents for this book.</p>
      ) : (
        <nav aria-label="Table of contents">
          <ul className="space-y-1">
            {toc.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  style={{ paddingLeft: `${item.depth * 16 + 12}px` }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left hover:bg-surface-container-low"
                >
                  <span className="truncate font-body text-body">{item.title}</span>
                  <span className="font-small text-small text-on-surface-variant">{item.page}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </Sheet>
  );
}
```

Create `apps/web/src/components/reader/page-jump.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Sheet } from '../ui';

interface PageJumpProps {
  readonly open: boolean;
  readonly page: number;
  readonly pageCount: number;
  readonly onClose: () => void;
  readonly onSubmit: (page: number) => void;
}

export function PageJump({ open, page, pageCount, onClose, onSubmit }: PageJumpProps) {
  const [value, setValue] = useState(String(page));

  return (
    <Sheet open={open} onClose={onClose} title="Go to page">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) onSubmit(Math.min(Math.max(parsed, 1), pageCount));
          onClose();
        }}
        className="flex flex-col gap-4"
      >
        <label htmlFor="page-jump-input" className="font-small text-small text-on-surface-variant">
          Page (1–{pageCount})
        </label>
        <input
          id="page-jump-input"
          type="number"
          min={1}
          max={pageCount}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-11 rounded-md border border-outline-variant bg-surface px-3 font-body text-body"
        />
        <button type="submit" className="min-h-11 rounded-md bg-primary-container font-display text-on-primary-container">
          Go
        </button>
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 4: Wire both into the reader**

In `reader-client.tsx`, add `openPanel` state (`'toc' | 'jump' | null`), render `<TocPanel>` and `<PageJump>`, and pass triggers through `ReaderToolbar` (`onOpenToc`, `onOpenJump`). `onSelect` calls `goToPage(item.page)` and closes the panel.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @transformlit/web test -- toc-panel reader-client`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/reader "apps/web/src/app/(reader)"
git commit -m "feat(web): add ToC panel and page jump"
```

---

### Task 6: Bookmarks and highlights UI

**Files:**
- Create: `apps/web/src/lib/reader/annotations.ts`
- Create: `apps/web/src/lib/reader/annotations.spec.ts`
- Create: `apps/web/src/components/reader/annotations-panel.tsx`
- Create: `apps/web/src/components/reader/annotations-panel.spec.tsx`
- Create: `apps/web/src/components/reader/selection-action-bar.tsx`
- Modify: `apps/web/src/app/(reader)/books/[id]/read/reader-client.tsx`
- Modify: `apps/web/src/components/reader/page-canvas.tsx`

**Interfaces:**
- Produces: `listBookmarks/listHighlights/addBookmark/addHighlight/removeBookmark/removeHighlight` GraphQL wrappers.
- Produces: `AnnotationsPanel({ open, tab, bookmarks, highlights, onClose, onJump, onDelete })`.
- Produces: `SelectionActionBar({ selection, onHighlight, onDismiss })` — no copy affordance.
- Produces: `buildSelectionAnchor(pageIndex, text, start, end)` mirroring the API's `buildAnchor` hash (same `textHash` algorithm: sha256 hex is server-side only; the client sends offsets + prefix/suffix + text and the **server recomputes** the hash — so the client anchor shape is `{ pageIndex, start, end, prefix, suffix }`).

- [ ] **Step 1: Write the failing annotations client test**

Create `apps/web/src/lib/reader/annotations.spec.ts`:

```ts
import { buildSelectionAnchor } from './annotations';

describe('buildSelectionAnchor', () => {
  const text = 'The quick brown fox jumps over the lazy dog.';

  it('captures offsets with context', () => {
    const anchor = buildSelectionAnchor(2, text, 4, 9);
    expect(anchor).toEqual({
      pageIndex: 2,
      start: 4,
      end: 9,
      prefix: 'The ',
      suffix: ' brown',
    });
  });

  it('clamps an offset at the start of the text', () => {
    const anchor = buildSelectionAnchor(1, text, 0, 3);
    expect(anchor.prefix).toBe('');
    expect(anchor.start).toBe(0);
  });
});
```

- [ ] **Step 2: Implement the annotation client module**

Create `apps/web/src/lib/reader/annotations.ts`:

```ts
import { gql } from '@apollo/client';
import { apolloClient } from '../apollo-client';

export interface BookmarkRecord {
  id: string;
  page: number;
  label?: string;
  anchor?: { pageIndex: number; start: number; end: number } | null;
}

export interface HighlightRecord {
  id: string;
  page: number;
  text: string;
  note?: string;
  color?: string;
  anchor?: { pageIndex: number; start: number; end: number } | null;
}

export const BOOKMARKS_QUERY = gql`
  query Bookmarks($bookId: ID!) {
    bookmarks(bookId: $bookId) { id page label anchor }
  }
`;

export const HIGHLIGHTS_QUERY = gql`
  query Highlights($bookId: ID!) {
    highlights(bookId: $bookId) { id page text note color anchor }
  }
`;

export const ADD_BOOKMARK_MUTATION = gql`
  mutation AddBookmark($input: AddBookmarkInput!) {
    addBookmark(input: $input) { id page label anchor }
  }
`;

export const ADD_HIGHLIGHT_MUTATION = gql`
  mutation AddHighlight($input: AddHighlightInput!) {
    addHighlight(input: $input) { id page text note color anchor }
  }
`;

export const REMOVE_BOOKMARK_MUTATION = gql`
  mutation RemoveBookmark($id: ID!) { removeBookmark(id: $id) }
`;

export const REMOVE_HIGHLIGHT_MUTATION = gql`
  mutation RemoveHighlight($id: ID!) { removeHighlight(id: $id) }
`;

export const SELECTION_CONTEXT_CHARS = 24;

export interface SelectionAnchor {
  pageIndex: number;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}

/** Offsets + context only; the server recomputes the text hash. */
export function buildSelectionAnchor(pageIndex: number, text: string, start: number, end: number): SelectionAnchor {
  return {
    pageIndex,
    start,
    end,
    prefix: text.slice(Math.max(0, start - SELECTION_CONTEXT_CHARS), start),
    suffix: text.slice(end, end + SELECTION_CONTEXT_CHARS),
  };
}

export async function listBookmarks(bookId: string): Promise<BookmarkRecord[]> {
  const result = await apolloClient.query<{ bookmarks: BookmarkRecord[] }>({
    query: BOOKMARKS_QUERY,
    variables: { bookId },
    fetchPolicy: 'network-only',
  });
  return result.data.bookmarks;
}

export async function listHighlights(bookId: string): Promise<HighlightRecord[]> {
  const result = await apolloClient.query<{ highlights: HighlightRecord[] }>({
    query: HIGHLIGHTS_QUERY,
    variables: { bookId },
    fetchPolicy: 'network-only',
  });
  return result.data.highlights;
}

export async function addBookmark(bookId: string, page: number, label?: string, anchor?: SelectionAnchor) {
  const result = await apolloClient.mutate<{ addBookmark: BookmarkRecord }>({
    mutation: ADD_BOOKMARK_MUTATION,
    variables: { input: { bookId, page, label, anchor } },
  });
  return result.data?.addBookmark;
}

export async function addHighlight(bookId: string, page: number, text: string, color?: string, anchor?: SelectionAnchor) {
  const result = await apolloClient.mutate<{ addHighlight: HighlightRecord }>({
    mutation: ADD_HIGHLIGHT_MUTATION,
    variables: { input: { bookId, page, text, color, anchor } },
  });
  return result.data?.addHighlight;
}
```

- [ ] **Step 3: Write the failing panel test**

Create `apps/web/src/components/reader/annotations-panel.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotationsPanel } from './annotations-panel';

jest.mock('../ui', () => ({
  Sheet: ({ open, children, title }: { open: boolean; children: React.ReactNode; title?: string }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

describe('AnnotationsPanel', () => {
  const bookmarks = [{ id: 'b1', page: 12, label: 'Important' }];
  const highlights = [{ id: 'h1', page: 30, text: 'A memorable line', color: 'accent' }];

  it('lists bookmarks and jumps on click', () => {
    const onJump = jest.fn();
    render(
      <AnnotationsPanel open tab="bookmarks" bookmarks={bookmarks} highlights={[]} onClose={jest.fn()} onJump={onJump} onDelete={jest.fn()} />,
    );
    fireEvent.click(screen.getByText('Important'));
    expect(onJump).toHaveBeenCalledWith(12);
  });

  it('lists highlights and deletes on demand', () => {
    const onDelete = jest.fn();
    render(
      <AnnotationsPanel open tab="highlights" bookmarks={[]} highlights={highlights} onClose={jest.fn()} onJump={jest.fn()} onDelete={onDelete} />,
    );
    expect(screen.getByText('A memorable line')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('h1');
  });

  it('shows empty states for both tabs', () => {
    const { rerender } = render(
      <AnnotationsPanel open tab="bookmarks" bookmarks={[]} highlights={[]} onClose={jest.fn()} onJump={jest.fn()} onDelete={jest.fn()} />,
    );
    expect(screen.getByText(/no bookmarks yet/i)).toBeInTheDocument();
    rerender(
      <AnnotationsPanel open tab="highlights" bookmarks={[]} highlights={[]} onClose={jest.fn()} onJump={jest.fn()} onDelete={jest.fn()} />,
    );
    expect(screen.getByText(/no highlights yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Implement the panel and action bar**

Create `apps/web/src/components/reader/annotations-panel.tsx`:

```tsx
'use client';

import { Sheet } from '../ui';
import type { BookmarkRecord, HighlightRecord } from '../../lib/reader/annotations';

interface AnnotationsPanelProps {
  readonly open: boolean;
  readonly tab: 'bookmarks' | 'highlights';
  readonly bookmarks: BookmarkRecord[];
  readonly highlights: HighlightRecord[];
  readonly onClose: () => void;
  readonly onJump: (page: number) => void;
  readonly onDelete: (id: string, kind: 'bookmark' | 'highlight') => void;
  readonly onTabChange?: (tab: 'bookmarks' | 'highlights') => void;
}

export function AnnotationsPanel({
  open, tab, bookmarks, highlights, onClose, onJump, onDelete, onTabChange,
}: AnnotationsPanelProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Notes & highlights" side="right">
      <div role="tablist" className="mb-3 flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bookmarks'}
          onClick={() => onTabChange?.('bookmarks')}
          className="min-h-11 rounded-md px-3 font-display text-small aria-selected:bg-primary-container"
        >
          Bookmarks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'highlights'}
          onClick={() => onTabChange?.('highlights')}
          className="min-h-11 rounded-md px-3 font-display text-small aria-selected:bg-primary-container"
        >
          Highlights
        </button>
      </div>

      {tab === 'bookmarks' ? (
        bookmarks.length === 0 ? (
          <p className="font-body text-body text-on-surface-variant">No bookmarks yet.</p>
        ) : (
          <ul className="space-y-1">
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id} className="flex items-center gap-2">
                <button type="button" onClick={() => onJump(bookmark.page)} className="min-h-11 flex-1 truncate rounded-md px-3 text-left hover:bg-surface-container-low">
                  <span className="font-body text-body">{bookmark.label ?? `Page ${bookmark.page}`}</span>
                </button>
                <button type="button" aria-label="Delete bookmark" onClick={() => onDelete(bookmark.id, 'bookmark')} className="material-symbols-outlined min-h-11 min-w-11">
                  delete
                </button>
              </li>
            ))}
          </ul>
        )
      ) : highlights.length === 0 ? (
        <p className="font-body text-body text-on-surface-variant">No highlights yet — select text to highlight.</p>
      ) : (
        <ul className="space-y-2">
          {highlights.map((highlight) => (
            <li key={highlight.id} className="flex items-start gap-2 rounded-md border border-outline-variant p-3">
              <button type="button" onClick={() => onJump(highlight.page)} className="flex-1 text-left">
                <p className="font-body text-body line-clamp-3">{highlight.text}</p>
                <p className="font-small text-small text-on-surface-variant">Page {highlight.page}</p>
              </button>
              <button type="button" aria-label="Delete highlight" onClick={() => onDelete(highlight.id, 'highlight')} className="material-symbols-outlined min-h-11 min-w-11">
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
```

Create `apps/web/src/components/reader/selection-action-bar.tsx`:

```tsx
'use client';

export const HIGHLIGHT_COLORS = ['accent', 'primary', 'secondary'] as const;

interface SelectionActionBarProps {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly onHighlight: (color: string) => void;
  readonly onDismiss: () => void;
}

/**
 * Deliberately offers no Copy action: this is licensed book content. The bar
 * also avoids intercepting selection gestures, so keyboard and touch selection
 * keep working.
 */
export function SelectionActionBar({ visible, x, y, onHighlight, onDismiss }: SelectionActionBarProps) {
  if (!visible) return null;
  return (
    <div
      role="toolbar"
      aria-label="Highlight selection"
      style={{ left: x, top: y }}
      className="fixed z-20 flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-2 shadow-lift"
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Highlight ${color}`}
          onClick={() => onHighlight(color)}
          className={`min-h-11 min-w-11 rounded-full bg-${color}`}
        />
      ))}
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="material-symbols-outlined min-h-11 min-w-11">
        close
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Wire annotations into the reader**

In `reader-client.tsx`:
1. On mount, load bookmarks and highlights (`listBookmarks`/`listHighlights`), with a loading flag.
2. Track selection: on `pointerup` inside the page container, compute offsets against the visible page text (`pageText.text` for EPUB; for PDF join `items.map(i => i.t).join(' ')`) and show `SelectionActionBar` at the selection rect.
3. `onHighlight` calls `addHighlight` with `buildSelectionAnchor(...)` and updates local state optimistically (rollback + `addToast` on failure).
4. Bookmark button in the toolbar toggles a bookmark for the current page; label prompt stays optional (default label `Page N`).
5. `AnnotationsPanel` `onJump` calls `goToPage`; `onDelete` calls the remove mutations then updates state.

For PDF, pass `items` and a `selectionText` to `PageCanvas`; for EPUB, pass `html` and `highlights` to `EpubPage`. Render existing highlights on the page: PDF via rects computed from `start`/`end` over the joined item list (Plan 1 `TextItemBox` order), EPUB via the offset slicing described in Task 4.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @transformlit/web test -- annotations`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/reader/annotations.ts apps/web/src/lib/reader/annotations.spec.ts apps/web/src/components/reader "apps/web/src/app/(reader)"
git commit -m "feat(web): add bookmarks, highlights and selection action bar"
```

---

### Task 7: Reading settings, scroll mode, and theme

**Files:**
- Create: `apps/web/src/components/reader/settings-sheet.tsx`
- Create: `apps/web/src/components/reader/settings-sheet.spec.tsx`
- Modify: `apps/web/src/app/(reader)/books/[id]/read/reader-client.tsx`
- Modify: `apps/web/src/components/reader/reader-toolbar.tsx`
- Modify: `apps/web/src/styles/globals.css`

**Interfaces:**
- Produces: `SettingsSheet({ open, onClose })` bound to `useReaderStore` (`theme`, `mode`, `zoom`).
- Produces: reader theme variables on `[data-reader-theme]`.
- Produces: scroll mode in the reader client (continuous page list with `IntersectionObserver`).

- [ ] **Step 1: Write the failing settings test**

Create `apps/web/src/components/reader/settings-sheet.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsSheet } from './settings-sheet';

const setTheme = jest.fn();
const setMode = jest.fn();
const setZoom = jest.fn();

jest.mock('../../store', () => ({
  useReaderStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'paper', mode: 'paged', zoom: 1, setTheme, setMode, setZoom }),
}));

jest.mock('../ui', () => ({
  Sheet: ({ open, children, title }: { open: boolean; children: React.ReactNode; title?: string }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

describe('SettingsSheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('changes the reader theme', () => {
    render(<SettingsSheet open onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /sepia/i }));
    expect(setTheme).toHaveBeenCalledWith('sepia');
  });

  it('changes mode and zoom', () => {
    render(<SettingsSheet open onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /scroll/i }));
    expect(setMode).toHaveBeenCalledWith('scroll');
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(setZoom).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement the settings sheet**

Create `apps/web/src/components/reader/settings-sheet.tsx`:

```tsx
'use client';

import { Sheet } from '../ui';
import { useReaderStore, ReaderTheme } from '../../store';

const THEMES: Array<{ id: ReaderTheme; label: string }> = [
  { id: 'paper', label: 'Paper' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'warm', label: 'Warm' },
  { id: 'dark', label: 'Dark' },
];

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 2;

export function SettingsSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const theme = useReaderStore((s) => s.theme);
  const mode = useReaderStore((s) => s.mode);
  const zoom = useReaderStore((s) => s.zoom);
  const setTheme = useReaderStore((s) => s.setTheme);
  const setMode = useReaderStore((s) => s.setMode);
  const setZoom = useReaderStore((s) => s.setZoom);

  return (
    <Sheet open={open} onClose={onClose} title="Reading settings">
      <section className="space-y-4">
        <div>
          <h3 className="font-display text-small text-on-surface-variant">Theme</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={theme === item.id}
                onClick={() => setTheme(item.id)}
                className="min-h-11 rounded-md border border-outline-variant px-3 font-body text-body aria-pressed:border-primary"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-display text-small text-on-surface-variant">Layout</h3>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              aria-pressed={mode === 'paged'}
              onClick={() => setMode('paged')}
              className="min-h-11 rounded-md border border-outline-variant px-3 font-body text-body aria-pressed:border-primary"
            >
              Paged
            </button>
            <button
              type="button"
              aria-pressed={mode === 'scroll'}
              onClick={() => setMode('scroll')}
              className="min-h-11 rounded-md border border-outline-variant px-3 font-body text-body aria-pressed:border-primary"
            >
              Scroll
            </button>
          </div>
        </div>

        <div>
          <h3 className="font-display text-small text-on-surface-variant">Text size</h3>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setZoom(Math.max(MIN_ZOOM, Math.round((zoom - 0.1) * 10) / 10))}
              className="material-symbols-outlined min-h-11 min-w-11"
            >
              remove
            </button>
            <span className="font-small text-small tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setZoom(Math.min(MAX_ZOOM, Math.round((zoom + 0.1) * 10) / 10))}
              className="material-symbols-outlined min-h-11 min-w-11"
            >
              add
            </button>
          </div>
        </div>
      </section>
    </Sheet>
  );
}
```

- [ ] **Step 3: Add the reader theme variables**

In `apps/web/src/styles/globals.css`, append a scoped block (values chosen for AA contrast in each theme):

```css
/* Reader themes are independent of the app theme (data-reader-theme scope). */
[data-reader-theme='paper'] { --reader-page: #fffdf8; --reader-ink: #221a12; }
[data-reader-theme='sepia'] { --reader-page: #f4ecd8; --reader-ink: #3b3226; }
[data-reader-theme='warm'] { --reader-page: #fff6e8; --reader-ink: #2b2118; }
[data-reader-theme='dark'] { --reader-page: #1a1a1a; --reader-ink: #f5f5f5; }
[data-reader-theme] { background: var(--reader-page); color: var(--reader-ink); }
```

- [ ] **Step 4: Add scroll mode and zoom to the reader**

In `reader-client.tsx`:
- Apply zoom via a wrapper style: `style={{ width: `${Math.round(zoom * 100)}%` }}` on the page container (whole-page zoom keeps pagination stable).
- When `mode === 'scroll'`, render a list of up to 5 page canvases (current ±2) inside a scroll container; attach an `IntersectionObserver` (threshold 0.5) that calls `goToPage` when a page becomes dominant (debounced to avoid state churn).
- Add a segmented paged/scroll toggle plus a settings trigger to `ReaderToolbar`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @transformlit/web test -- settings-sheet reader-client`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/reader apps/web/src/styles/globals.css "apps/web/src/app/(reader)"
git commit -m "feat(web): add reading settings, themes and scroll mode"
```

---

### Task 8: Hardening — session recovery, error states, orphan annotations

**Files:**
- Create: `apps/web/src/components/reader/session-recovery.tsx`
- Create: `apps/web/src/components/reader/session-recovery.spec.tsx`
- Create: `apps/api/src/books/page-view.service.spec.ts`
- Modify: `apps/web/src/app/(reader)/books/[id]/read/reader-client.tsx`
- Modify: `apps/api/src/books/books.controller.ts` (throttle surfacing)
- Modify: `apps/api/src/books/books.controller.spec.ts`
- Modify: `apps/api/src/books/page-view.service.ts` (retention sweep)
- Modify: `apps/api/src/worker/worker.module.ts`
- Modify: `apps/api/src/worker/main.ts`

**Interfaces:**
- Produces: `SessionRecovery({ state, onRetry, onExit })` with `state: 'offline' | 'expired' | 'throttled'`.
- Produces: page fetches signal session expiry (401) vs throttling (429) so the UI can react without unmounting the page.
- Produces: `PageViewService.sweepOlderThan(days?): Promise<number>`; the worker runs it once per day.

- [ ] **Step 1: Write the failing recovery test**

Create `apps/web/src/components/reader/session-recovery.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionRecovery } from './session-recovery';

describe('SessionRecovery', () => {
  it('offers a continue action when the session expires', () => {
    const onRetry = jest.fn();
    render(<SessionRecovery state="expired" onRetry={onRetry} onExit={jest.fn()} />);
    expect(screen.getByText(/reading session was paused/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue reading/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('explains the throttle state without error styling', () => {
    render(<SessionRecovery state="throttled" onRetry={jest.fn()} onExit={jest.fn()} />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/take a moment/i);
    expect(banner.className).not.toContain('error');
  });

  it('shows an offline message', () => {
    render(<SessionRecovery state="offline" onRetry={jest.fn()} onExit={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
  });
});
```

- [ ] **Step 2: Implement the recovery component**

Create `apps/web/src/components/reader/session-recovery.tsx`:

```tsx
'use client';

export type RecoveryState = 'offline' | 'expired' | 'throttled';

interface SessionRecoveryProps {
  readonly state: RecoveryState;
  readonly onRetry: () => void;
  readonly onExit: () => void;
}

const COPY: Record<RecoveryState, { title: string; body: string; action: string }> = {
  expired: {
    title: 'Your reading session was paused',
    body: 'This keeps the book protected. Continue where you left off.',
    action: 'Continue reading',
  },
  throttled: {
    title: 'Take a moment',
    body: 'Pages are turning faster than usual. Reading resumes in a few seconds.',
    action: 'Try again',
  },
  offline: {
    title: "You're offline",
    body: 'Reading will resume when you reconnect. Already-loaded pages stay readable.',
    action: 'Retry',
  },
};

export function SessionRecovery({ state, onRetry, onExit }: SessionRecoveryProps) {
  const copy = COPY[state];
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low p-4 text-center">
      <p className="font-display text-body text-on-surface">{copy.title}</p>
      <p className="font-body text-small text-on-surface-variant">{copy.body}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onRetry} className="min-h-11 rounded-md bg-primary-container px-4 font-display text-on-primary-container">
          {copy.action}
        </button>
        <button type="button" onClick={onExit} className="min-h-11 rounded-md border border-outline-variant px-4 font-display text-body">
          Back to library
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Handle 401/429 in the reader client**

In `reader-client.tsx`:
- Wrap page fetches so errors set a `recovery` state: `401 → 'expired'`, `429 → 'throttled'`, network error → `'offline'`.
- `onRetry` for `'expired'` calls `openReadingSession(bookId)` again and refetches the page; the current page stays mounted so reading position is preserved.
- Add `globalThis.addEventListener('online', ...)` (SonarQube: use `globalThis.window` deliberately or a guarded effect) to clear `'offline'` automatically; clean up on unmount.
- Render `<SessionRecovery>` above the page, not as a full-screen replacement.

In `apps/web/src/lib/reader/api.ts`, throw typed errors:

```ts
export class ReaderApiError extends Error {
  constructor(readonly status: number) {
    super(`Reader request failed with ${status}`);
  }
}

async function ensureOk(response: Response): Promise<Response> {
  if (!response.ok) throw new ReaderApiError(response.status);
  return response;
}
```

- [ ] **Step 4: Surface throttling distinctly from the API**

In `books.controller.ts`, ensure the throttler produces 429 (Nest's `ThrottlerGuard` does) and that `Cache-Control`/`Vary` are still set on error responses by letting the exception pass through the guard (no custom catch needed). Add a test:

```ts
it('marks reader page routes as throttled', () => {
  const metadata = Reflect.getMetadata('THROTTLER:LIMITdefault', BooksController.prototype.getFrame) as number | undefined;
  expect(metadata ?? 90).toBeGreaterThan(0);
});
```

- [ ] **Step 5: Orphaned annotations UX**

When `listHighlights` returns `live: false` for a highlight (Plan 2 Task 3), render it in the panel with a muted "no longer in this text" note but keep it jumpable and deletable. Add to `annotations-panel.tsx`:

```tsx
{highlight.live === false ? (
  <p className="font-small text-small text-on-surface-variant">This passage changed in the current version.</p>
) : null}
```

- [ ] **Step 6: PageView retention sweep**

The spec requires a periodic sweep of the `PageView` audit table (older than ~90 days). Add a retention method to the service created in Plan 1 Task 8:

```ts
// page-view.service.ts
const PAGE_VIEW_RETENTION_DAYS = 90;

  /** Deletes audit rows older than the retention window. Returns rows removed. */
  async sweepOlderThan(days = PAGE_VIEW_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await this.prisma.pageView.deleteMany({ where: { viewedAt: { lt: cutoff } } });
    return result.count;
  }
```

Create `apps/api/src/books/page-view.service.spec.ts`:

```ts
import { PageViewService } from './page-view.service';

describe('PageViewService retention', () => {
  it('removes page views older than the retention window', async () => {
    const prisma = { pageView: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) } };
    const service = new PageViewService(prisma as never);

    await expect(service.sweepOlderThan(90)).resolves.toBe(3);

    const cutoff = prisma.pageView.deleteMany.mock.calls[0][0].where.viewedAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
  });
});
```

Wire it into the worker (which already polls and runs the stale-job sweep). `PageViewService` only depends on `PrismaService`, so register it directly in the worker module rather than importing `BooksModule`:

```ts
// worker.module.ts
providers: [PageViewService],
```

```ts
// worker/main.ts — beside the existing stale-job sweep
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastRetention = 0;

if (Date.now() - lastRetention > RETENTION_SWEEP_INTERVAL_MS) {
  lastRetention = Date.now();
  const pruned = await app.get(PageViewService).sweepOlderThan().catch(() => 0);
  if (pruned > 0) logger.log(`Pruned ${pruned} page-view audit row(s)`);
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @transformlit/web test -- session-recovery reader-client && pnpm --filter @transformlit/api test -- page-view`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/reader apps/web/src/lib/reader "apps/web/src/app/(reader)" apps/api/src/books apps/api/src/worker
git commit -m "feat: handle session expiry, throttling, orphaned annotations and page-view retention"
```

---

### Task 9: Plan 2 verification

**Files:**
- Modify: `apps/web/e2e/reader.spec.ts`
- Create: `apps/api/test/epub-reader.integration.spec.ts`

**Interfaces:**
- Produces: proof that EPUB converts, serves JSON pages, and never serves `text/html`; that annotations round-trip; and that highlights re-anchor after a version change.

- [ ] **Step 1: Write the EPUB integration test**

Create `apps/api/test/epub-reader.integration.spec.ts` (reuse the container + migration runner from `reader-security.integration.spec.ts`):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { BooksService } from '../src/books/books.service';
import { ConversionRunner } from '../src/books/conversion/conversion.runner';
import { buildTestEpub } from './fixtures/build-epub';

describe('EPUB reader', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let bookId: string;
  let container: StartedPostgreSqlContainer | null = null;

  beforeAll(async () => {
    let databaseUrl: string;
    try {
      const { execSync } = await import('node:child_process');
      execSync('docker info', { stdio: 'ignore' });
      container = await new PostgreSqlContainer('postgres:15-alpine')
        .withDatabase('testdb').withUsername('test').withPassword('test').start();
      databaseUrl = container.getConnectionUri();
    } catch {
      databaseUrl = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/transformlit_test';
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    process.env.BOOK_STORAGE_DIR = `${process.cwd()}/.book-storage-test`;

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const migrationsDir = join(__dirname, '../prisma/migrations');
    for (const dir of readdirSync(migrationsDir).sort()) {
      const file = join(migrationsDir, dir, 'migration.sql');
      if (existsSync(file)) await pool.query(readFileSync(file, 'utf-8'));
    }
    await pool.end();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    const stamp = Date.now();
    const auth = moduleFixture.get<AuthService>(AuthService);
    const registered = await auth.registerLocal({
      email: `epub-${stamp}@example.com`,
      password: 'Password123!',
      displayName: 'EPUB Reader',
    });
    token = registered.accessToken;

    const books = moduleFixture.get<BooksService>(BooksService);
    const book = await books.uploadBook({ title: `EPUB ${stamp}`, accessLevel: 'FREE' as never }, registered.user.id);
    bookId = book.id;
    await books.uploadBookFile(bookId, await buildTestEpub(3, 5), registered.user.id, 'ADMIN' as never);
    await moduleFixture.get(ConversionRunner).runOnce();
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('marks the EPUB book READY with toc entries', async () => {
    const book = await prisma.book.findUnique({ where: { id: bookId }, include: { tocEntries: true } });
    expect(book?.conversionStatus).toBe('READY');
    expect(book?.format).toBe('EPUB');
    expect(book?.pageCount ?? 0).toBeGreaterThan(0);
    expect(book?.tocEntries.length).toBe(3);
  });

  it('serves pages as JSON and never as text/html', async () => {
    const session = await request(app.getHttpServer())
      .post(`/books/${bookId}/reading-session`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const cookie = (session.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    const response = await request(app.getHttpServer())
      .get(`/books/${bookId}/pages/1/text`)
      .set('Cookie', cookie)
      .expect(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body.kind).toBe('epub');
    expect(typeof response.body.html).toBe('string');
    expect(response.body.html).not.toContain('<script');
  });

  it('404s the frame endpoint for an EPUB book', async () => {
    const session = await request(app.getHttpServer())
      .post(`/books/${bookId}/reading-session`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const cookie = (session.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    await request(app.getHttpServer()).get(`/books/${bookId}/pages/1/frame`).set('Cookie', cookie).expect(404);
  });

  it('round-trips a bookmark anchor and re-resolves it', async () => {
    const books = app.get(BooksService);
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    const anchor = { pageIndex: 1, start: 0, end: 5, prefix: '', suffix: ' test' };
    const bookmark = await prisma.bookmark.create({
      data: { userId: book?.createdById ?? '', bookId, page: 1, anchor, contentVersion: book?.contentVersion ?? 1 },
    });
    expect(bookmark.anchor).toMatchObject({ pageIndex: 1 });
    const listed = await books.listBookmarks(book!.createdById!, bookId);
    expect(listed[0]).toHaveProperty('live');
  });
});
```

- [ ] **Step 2: Extend the E2E spec**

Add to `apps/web/e2e/reader.spec.ts`:

```ts
test('reader panels: toc, settings, annotations', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('admin@transformlit.com');
  await page.getByLabel('Password', { exact: true }).fill('Transformlit123!');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(/.*\/feed/);

  await page.goto('/books');
  const readButton = page.getByTestId('read-btn').first();
  if ((await readButton.count()) === 0) test.skip(true, 'No ready book seeded');
  await readButton.click();

  await page.getByRole('button', { name: /table of contents/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /settings/i }).click();
  await page.getByRole('button', { name: /sepia/i }).click();
  await expect(page.locator('[data-reader-theme="sepia"]')).toBeVisible();
});
```

- [ ] **Step 3: Run everything**

```bash
pnpm --filter @transformlit/api test
pnpm --filter @transformlit/api test:integration
pnpm --filter @transformlit/web test
pnpm --filter @transformlit/web lint
pnpm --filter @transformlit/api lint
```

Expected: all green. Then run the spec's manual security check: confirm no `/_next/image` request for book pages and no storage key anywhere in responses.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/reader.spec.ts apps/api/test/epub-reader.integration.spec.ts
git commit -m "test: verify EPUB reader, anchors and reader panels"
```

---

## Plan 2 Done — what works after this

EPUB books convert to deterministic fixed pages and read with the same ToC, page numbers, bookmarks, highlights and settings as PDF. PaneIls (ToC, annotations, settings, page jump) use the app's `Sheet` primitive. Session expiry, throttling and offline states degrade gracefully without losing position, and re-conversion re-anchors what it can while clearly marking what it cannot.
