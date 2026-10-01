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

    // Allocate the version ATOMICALLY before the long render. The increment is a
    // single row update, so two concurrent jobs for one book can never pick the
    // same number — and thus can never share an asset prefix. Waiting until
    // commit to compute `previousVersion + 1` from a pre-render read races: both
    // writers pick v2, overwrite each other's bytes, and the loser's unique
    // violation rolls back while the winner's committed checksums no longer
    // match the (now overwritten) offline bytes.
    const reserved = await this.prisma.book.update({
      where: { id: bookId },
      data: { contentVersion: { increment: 1 } },
      select: { contentVersion: true },
    });
    const nextVersion = reserved.contentVersion;

    try {
      const converted = await this.pdfConverter.convert({ bookId, contentVersion: nextVersion, buffer });

      // The immutable version and the current-version projection commit together.
      // Only the newest reservation may swap the shared current projection
      // (`book_pages`/`book_toc_entries` are unique per book): if a later job
      // has since reserved a higher version, this one records its own immutable
      // version but must not clobber the newer projection. Gating on the exact
      // reserved value keeps the pointer and projection in lockstep even when a
      // lower-version job commits after a higher-version one.
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.book.updateMany({
          where: { id: bookId, contentVersion: nextVersion },
          data: {
            format: 'PDF',
            pageCount: converted.pageCount,
            conversionStatus: 'READY',
            conversionError: null,
          },
        });

        if (claimed.count > 0) {
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
              charCount: page.charCount,
            })),
          });
          await tx.bookTocEntry.createMany({
            data: converted.toc.map((entry) => ({ bookId, title: entry.title, page: entry.page, depth: entry.depth, order: entry.order })),
          });
        }

        await tx.bookContentVersion.create({
          data: {
            bookId,
            contentVersion: nextVersion,
            title: book.title,
            author: book.author,
            description: book.description,
            format: 'PDF',
            pageCount: converted.pageCount,
            eligible: true,
            verifiedAt: new Date(),
            pages: {
              create: converted.pages.map((page) => ({
                index: page.index,
                assetKey: page.assetKey,
                textKey: page.textKey,
                hasTextLayer: page.hasTextLayer,
                mimeType: page.mimeType,
                width: page.width,
                height: page.height,
                charCount: page.charCount,
                frameByteLength: page.frameByteLength,
                frameSha256: page.frameSha256,
                textByteLength: page.textByteLength,
                textSha256: page.textSha256,
              })),
            },
            tocEntries: {
              create: converted.toc.map((entry) => ({
                title: entry.title,
                page: entry.page,
                depth: entry.depth,
                order: entry.order,
              })),
            },
          },
        });
      });
    } catch (error) {
      // The reservation was only a counter; nothing durable points at it yet.
      // Release it so a retry can reuse the same number, but guard on the exact
      // value so a concurrent job that has since allocated and committed a
      // higher version is never decremented out from under its pointer.
      await this.prisma.book.updateMany({
        where: { id: bookId, contentVersion: nextVersion },
        data: { contentVersion: { decrement: 1 } },
      });
      throw error;
    }

    // Intentionally do NOT delete the previous version's asset prefix: retained
    // versions must stay downloadable while pinned annotations/downloads refer
    // to them. Assets are cleaned up only by an explicit retention policy.
  }
}
