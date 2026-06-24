import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient } from '@azure/storage-blob';

@Injectable()
export class BlobService {
  private readonly logger = new Logger(BlobService.name);
  private client: BlobServiceClient;

  constructor(private readonly config: ConfigService) {
    const connStr = this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING');
    if (connStr) {
      this.client = BlobServiceClient.fromConnectionString(connStr);
    }
  }

  async streamPdf(blobPath: string): Promise<NodeJS.ReadableStream | null> {
    if (!this.client) return null;
    const containerClient = this.client.getContainerClient('pdfs');
    const blobClient = containerClient.getBlobClient(blobPath);
    const exists = await blobClient.exists();
    if (!exists) return null;
    const download = await blobClient.download();
    return download.readableStreamBody;
  }

  async uploadPdf(
    blobPath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.client) throw new Error('Blob storage not configured');
    const containerClient = this.client.getContainerClient('pdfs');
    await containerClient.createIfNotExists();
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    await blobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return blobClient.url;
  }
}
