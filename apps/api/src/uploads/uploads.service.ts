import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, existsSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { promisify } from 'node:util';
import { BlobServiceClient } from '@azure/storage-blob';

const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87_MAGIC = Buffer.from('GIF87a', 'ascii');
const GIF89_MAGIC = Buffer.from('GIF89a', 'ascii');
const WEBP_RIFF = Buffer.from('RIFF', 'ascii');
const WEBP_WEBP = Buffer.from('WEBP', 'ascii');

function bufferStartsWith(buf: Buffer, magic: Buffer): boolean {
  return buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

/**
 * Sniff the actual image type from magic bytes (content is the source of
 * truth — the client-declared mimetype is untrusted). Returns the detected
 * mime type for a supported image, or null when the bytes are not a jpeg,
 * png, webp or gif.
 */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bufferStartsWith(buffer, PNG_MAGIC)) return 'image/png';
  if (bufferStartsWith(buffer, GIF87_MAGIC) || bufferStartsWith(buffer, GIF89_MAGIC)) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    bufferStartsWith(buffer, WEBP_RIFF) &&
    buffer.subarray(8, 12).equals(WEBP_WEBP)
  ) {
    return 'image/webp';
  }
  return null;
}

/** Repo-root uploads dir (found via pnpm-workspace.yaml sentinel), or UPLOAD_DIR env */
function resolveLocalDir(config: ConfigService): string {
  const env = config.get<string>('UPLOAD_DIR');
  if (env) return env;
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return join(dir, 'images', 'uploads');
    }
    dir = dirname(dir);
  }
  return join(process.cwd(), 'images', 'uploads');
}

@Injectable()
export class UploadsService {
  private readonly azureClient: BlobServiceClient | null;
  private readonly localDir: string;

  constructor(private readonly config: ConfigService) {
    const connStr = this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING');
    this.azureClient = connStr
      ? BlobServiceClient.fromConnectionString(connStr)
      : null;
    this.localDir = resolveLocalDir(config);
  }

  async saveImage(buffer: Buffer, mimetype: string): Promise<string> {
    // Content (magic bytes) is the source of truth; the client-declared
    // mimetype is untrusted and may disagree with what was actually uploaded
    // (e.g. an HTML/JS polyglot declared as image/png). Refuse to persist
    // anything whose bytes are not a real image, and refuse declared types
    // that do not match the sniffed content so stored files can never be
    // served under a misleading Content-Type.
    const detected = sniffImageType(buffer);
    if (!detected || EXT_BY_MIME[detected] === undefined || detected !== mimetype) {
      throw new BadRequestException('File content does not match its declared type');
    }
    const ext = EXT_BY_MIME[detected];
    const name = `${randomUUID()}.${ext}`;

    if (this.azureClient) {
      const container = this.azureClient.getContainerClient('uploads');
      await container.createIfNotExists();
      const blob = container.getBlockBlobClient(name);
      await blob.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: detected! },
      });
      return blob.url;
    }

    await mkdirAsync(this.localDir, { recursive: true });
    await writeFileAsync(join(this.localDir, name), buffer);
    return `uploads/${name}`;
  }

  /**
   * Local-driver path for a key (either `uploads/<name>` from saveImage or a
   * bare `<name>` from the GET route), or null for URLs / unsafe names.
   */
  resolveLocalPath(key: string): string | null {
    if (key.includes('://')) return null; // never resolve URLs to local files
    const name = basename(key);
    if (!name || name === '.' || name === '..') return null;
    return join(this.localDir, name);
  }

  localFileExists(key: string): boolean {
    const p = this.resolveLocalPath(key);
    return p !== null && existsSync(p);
  }

  extOf(mimetypeOrPath: string): string {
    return extname(mimetypeOrPath).replace('.', '') || 'bin';
  }
}
