import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { STORAGE_ADAPTER, StorageAdapter } from '../../storage/storage-adapter.js';
import { ConversionJobService } from './conversion-job.service.js';
import { PdfConverter } from './pdf.converter.js';

@Injectable()
export class ConversionRunner {
  private readonly logger = new Logger(ConversionRunner.name);

  constructor(
    private readonly jobs: ConversionJobService,
    private readonly pdfConverter: PdfConverter,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly prisma: PrismaService,
  ) {}

  /** Claims and processes at most one job. Returns whether work was done. */
  async runOnce(): Promise<boolean> {
    const job = await this.jobs.claimNext();
    if (!job) return false;

    try {
      await this.process(job.bookId);
      await this.jobs.complete(job.id);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Conversion failed for book ${job.bookId}: ${message}`);
      await this.jobs.fail(job.id, message);
      return true;
    }
  }

  private async process(bookId: string): Promise<void> {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book?.blobPath) throw new Error('Book has no stored original');

    const buffer = await this.storage.getBuffer(book.blobPath);
    if (!buffer) throw new Error('Stored original is missing');

    const previousVersion = book.contentVersion ?? 1;
    const nextVersion = previousVersion + 1;
    const converted = await this.pdfConverter.convert({ bookId, contentVersion: nextVersion, buffer });

    await this.prisma.$transaction(async (tx) => {
      await tx.bookPage.deleteMany({ where: { bookId } });
      await tx.bookTocEntry.deleteMany({ where: { bookId } });
      await tx.bookPage.createMany({
        data: converted.pages.map((page) => ({
          bookId,
          index: page.index,
          assetKey: page.assetKey,
          textKey: page.textKey,
          mimeType: page.mimeType,
          width: page.width,
          height: page.height,
        })),
      });
      await tx.bookTocEntry.createMany({
        data: converted.toc.map((entry) => ({ bookId, title: entry.title, page: entry.page, depth: entry.depth, order: entry.order })),
      });
      await tx.book.update({
        where: { id: bookId },
        data: {
          format: 'PDF',
          pageCount: converted.pageCount,
          conversionStatus: 'READY',
          conversionError: null,
          contentVersion: nextVersion,
        },
      });
    });

    await this.storage.deletePrefix(`books/${bookId}/v${previousVersion}`);
  }
}
