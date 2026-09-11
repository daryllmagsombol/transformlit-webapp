import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A 64x64 grayscale JPEG2000 codestream (white field with a black square),
 * encoded with `opj_compress` and committed as `jpx-page.j2k`. Used to prove
 * the converter can rasterize `JPXDecode` page images — the decoders shipped
 * with `pdfjs-dist` are what make scanned PDFs render instead of going blank.
 */
const JP2_PATH = join(__dirname, 'jpx-page.j2k');

const SOC = 0xff4f;
const SIZ = 0xff51;

/** Reads Xsiz/Ysiz from the codestream's SIZ marker (ISO/IEC 15444-1). */
function readJp2Size(jp2: Buffer): { width: number; height: number } {
  if (jp2.readUInt16BE(0) !== SOC || jp2.readUInt16BE(2) !== SIZ) {
    throw new Error('jpx-page.j2k is not a raw JPEG2000 codestream');
  }
  return { width: jp2.readUInt32BE(8), height: jp2.readUInt32BE(12) };
}

/**
 * Builds a minimal one-page PDF that paints `jp2` as a single image XObject
 * using `/Filter /JPXDecode`. Mirrors `build-pdf.ts`: object offsets are
 * computed while assembling, so the xref table is correct.
 */
export function buildJpxPdf(jp2: Buffer = readFileSync(JP2_PATH)): Buffer {
  const { width, height } = readJp2Size(jp2);
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n`),
      Buffer.from(content, 'latin1'),
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode /Length ${jp2.length} >>\nstream\n`,
      ),
      jp2,
      Buffer.from('\nendstream'),
    ]),
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    chunks.push(object);
    offset += object.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const objectOffset of offsets) {
    xref += `${String(objectOffset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, 'latin1'));

  return Buffer.concat(chunks);
}
