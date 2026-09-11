// Builds a minimal valid multi-page PDF with Helvetica text so tests never
// depend on a committed binary. Object offsets are computed while assembling,
// so the xref table is correct.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function escapePdfText(value: string): string {
  return value.split('(').join(String.raw`\(`).split(')').join(String.raw`\)`);
}

export function buildTestPdf(pages: string[]): Buffer {
  if (pages.length === 0) throw new Error('buildTestPdf needs at least one page');

  const objects: string[] = [];
  const pageObjIds: number[] = [];
  let nextId = 1;

  const catalogId = nextId;
  const pagesId = nextId + 1;
  const fontId = nextId + 2;
  nextId += 3;

  pages.forEach((text, index) => {
    const pageId = nextId;
    const contentId = nextId + 1;
    nextId += 2;
    pageObjIds.push(pageId);
    const content = `BT /F1 24 Tf 72 ${PAGE_HEIGHT - 100} Td (${escapePdfText(`${text} - page ${index + 1}`)}) Tj ET`;
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj\n`,
      `${contentId} 0 obj << /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
  });

  const kids = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  objects.push(
    `${catalogId} 0 obj << /Type /Catalog /Pages ${pagesId} 0 R >> endobj\n`,
    `${pagesId} 0 obj << /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >> endobj\n`,
    `${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n`,
  );

  const ordered = objects.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  let body = '%PDF-1.4\n';
  const offsets = new Map<number, number>();
  for (const object of ordered) {
    const id = Number.parseInt(object, 10);
    offsets.set(id, Buffer.byteLength(body, 'latin1'));
    body += object;
  }

  const maxId = nextId - 1;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    xref += `${String(offsets.get(id) ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${Buffer.byteLength(body, 'latin1')}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'latin1');
}
