import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
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

@Injectable()
export class UploadsService {
  private readonly azureClient: BlobServiceClient | null;
  private readonly localDir: string;

  constructor(private readonly config: ConfigService) {
    const connStr = this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING');
    this.azureClient = connStr
      ? BlobServiceClient.fromConnectionString(connStr)
      : null;
    this.localDir =
      this.config.get<string>('UPLOAD_DIR') ??
      join(process.cwd(), '..', 'images', 'uploads');
  }

  async saveImage(buffer: Buffer, mimetype: string): Promise<string> {
    const ext = EXT_BY_MIME[mimetype];
    if (!ext) throw new Error(`Unsupported image type: ${mimetype}`);
    const name = `${randomUUID()}.${ext}`;

    if (this.azureClient) {
      const container = this.azureClient.getContainerClient('uploads');
      await container.createIfNotExists();
      const blob = container.getBlockBlobClient(name);
      await blob.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: mimetype },
      });
      return blob.url;
    }

    await mkdirAsync(this.localDir, { recursive: true });
    await writeFileAsync(join(this.localDir, name), buffer);
    return `uploads/${name}`;
  }

  /** Local-driver path for a key, or null if not a local uploads key */
  resolveLocalPath(key: string): string | null {
    if (!key.startsWith('uploads/')) return null;
    return join(this.localDir, basename(key));
  }

  localFileExists(key: string): boolean {
    const p = this.resolveLocalPath(key);
    return p !== null && existsSync(p);
  }

  extOf(mimetypeOrPath: string): string {
    return extname(mimetypeOrPath).replace('.', '') || 'bin';
  }
}
