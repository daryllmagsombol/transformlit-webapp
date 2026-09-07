/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sniffImageType, UploadsService } from './uploads.service';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);
const GIF_BYTES = Buffer.from('GIF89a\x10\x00\x10\x00', 'binary');

describe('sniffImageType', () => {
  it('detects jpeg from FF D8 FF magic bytes', () => {
    expect(sniffImageType(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('detects png from its 8-byte signature', () => {
    expect(sniffImageType(PNG_BYTES)).toBe('image/png');
  });

  it('detects webp from the RIFF....WEBP container', () => {
    expect(sniffImageType(WEBP_BYTES)).toBe('image/webp');
  });

  it('detects gif from GIF87a or GIF89a headers', () => {
    expect(sniffImageType(GIF_BYTES)).toBe('image/gif');
    expect(sniffImageType(Buffer.from('GIF87a....', 'binary'))).toBe('image/gif');
  });

  it('returns null for non-image / too-short buffers', () => {
    expect(sniffImageType(Buffer.from('<html>polyglot</html>'))).toBeNull();
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it('does not treat random 3-byte data starting FF D8 as a full jpeg past the header', () => {
    // Only the 3-byte jpeg marker is sniffed; anything else (wrong declared
    // type or trailing non-image content) is caught by the declared-type check
    // in saveImage, not here.
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]))).toBe('image/jpeg');
  });
});

describe('UploadsService (local driver)', () => {
  let service: UploadsService;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-test-'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'UPLOAD_DIR' ? dir : undefined),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(UploadsService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves a real png buffer and returns an uploads/ key', async () => {
    const key = await service.saveImage(PNG_BYTES, 'image/png');
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
    const saved = await readFile(join(dir, key.replace('uploads/', '')));
    expect(saved).toEqual(PNG_BYTES);
  });

  it('rejects non-image bytes declared as an image type', async () => {
    const htmlPolyglot = Buffer.from('<html><script>alert(1)</script></html>');
    await expect(service.saveImage(htmlPolyglot, 'image/png')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects real image bytes whose declared type does not match the content', async () => {
    await expect(service.saveImage(JPEG_BYTES, 'image/png')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.saveImage(PNG_BYTES, 'image/jpeg')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an unsupported declared type', async () => {
    await expect(service.saveImage(PNG_BYTES, 'text/html')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resolveLocalPath accepts uploads/ keys and bare names, rejects URLs', () => {
    expect(service.resolveLocalPath('uploads/x.png')).toContain('x.png');
    expect(service.resolveLocalPath('x.png')).toContain('x.png');
    expect(service.resolveLocalPath('http://evil/x.png')).toBeNull();
  });
});
