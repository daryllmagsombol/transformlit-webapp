import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export const MAX_CONVERSION_ATTEMPTS = 3;

export interface ClaimedJob {
  id: string;
  bookId: string;
  attempts: number;
}

@Injectable()
export class ConversionJobService {
  private readonly logger = new Logger(ConversionJobService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(bookId: string): Promise<void> {
    await this.prisma.bookConversionJob.create({ data: { bookId, status: 'PENDING' } });
  }

  /**
   * Atomically claims one job. Stale PROCESSING jobs (worker died mid-run) are
   * reclaimable after 15 minutes.
   */
  async claimNext(): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE book_conversion_jobs
      SET status = 'PROCESSING', "lockedAt" = now(), "updatedAt" = now()
      WHERE id = (
        SELECT id FROM book_conversion_jobs
        WHERE status = 'PENDING'
           OR (status = 'PROCESSING' AND "lockedAt" < now() - interval '15 minutes')
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "bookId", attempts
    `;
    return rows[0] ?? null;
  }

  async complete(jobId: string): Promise<void> {
    await this.prisma.bookConversionJob.update({
      where: { id: jobId },
      data: { status: 'READY', lockedAt: null, lastError: null },
    });
  }

  async fail(jobId: string, error: string): Promise<void> {
    const job = await this.prisma.bookConversionJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', lockedAt: null, lastError: error, attempts: { increment: 1 } },
    });
    if (job.attempts >= MAX_CONVERSION_ATTEMPTS) {
      await this.prisma.bookConversionJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', lockedAt: null, lastError: error, attempts: { increment: 1 } },
      });
      await this.prisma.book.update({
        where: { id: job.bookId },
        data: { conversionStatus: 'FAILED', conversionError: error },
      });
      this.logger.warn(`Conversion permanently failed for book ${job.bookId}: ${error}`);
    }
  }

  async requeueStale(olderThanMs: number): Promise<number> {
    const result = await this.prisma.bookConversionJob.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - olderThanMs) } },
      data: { status: 'PENDING', lockedAt: null },
    });
    return result.count;
  }
}
