/**
 * Spike: verify PDF rasterization + text-item extraction on this runtime.
 * Run: pnpm --filter @transformlit/api exec tsx test/fixtures/spike-pdf.ts
 *
 * Verified contract (run 2026-09-10 on macOS/darwin, unpdf@1.8.1 + @napi-rs/canvas@1.0.9, tsx):
 * - render: renderPageAsImage(doc, pageNumber, { scale, canvasImport }) is accepted as-is;
 *           `canvasImport: () => import('@napi-rs/canvas')` works, so the
 *           pdfjs-dist fallback path (page.render({ canvasContext, viewport })) is NOT needed.
 * - text:   doc.getPage(n).getTextContent() -> items[].{ str, transform, width, height };
 *           page 1 yields 1 non-empty `str` item for the fixture text.
 * - output: Uint8Array of PNG bytes; scale 2 rasterizes a 612x792 page to 1224x1584 RGBA.
 *
 * Observed run output: {"pageCount":2,"itemCount":1,"bytes":19719}
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { buildTestPdf } from './build-pdf';

async function main() {
  const pdf = buildTestPdf(['Hello reader', 'Second page']);
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const pageCount = doc.numPages;

  const first = await doc.getPage(1);
  const textContent = await first.getTextContent();
  const itemCount = textContent.items.filter((item) => 'str' in item && item.str.trim().length > 0).length;

  const image = await renderPageAsImage(doc, 1, {
    scale: 2,
    canvasImport: () => import('@napi-rs/canvas'),
  });
  const out = join(tmpdir(), 'spike-page-1.png');
  writeFileSync(out, Buffer.from(image));

  console.log(JSON.stringify({ pageCount, itemCount, out, bytes: image.byteLength }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
