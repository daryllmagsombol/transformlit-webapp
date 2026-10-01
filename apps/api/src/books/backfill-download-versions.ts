import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BookDownloadBackfillModule } from './book-download-backfill.module.js';
import { BookDownloadService } from './book-download.service.js';

/**
 * One-shot operator entrypoint that promotes legacy `BookContentVersion` rows
 * to `eligible = true` after re-verifying their real stored frame/text bytes.
 *
 * The Task 5 migration backfills every existing READY/PDF book as a version
 * snapshot with `eligible = false` and NULL checksums: SQL cannot hash object
 * storage, so it must not fabricate integrity metadata. Run this once after
 * deploying the migration to make prior books downloadable; it is idempotent
 * and only ever inspects ineligible rows.
 *
 * Usage (from the API workspace, with DATABASE_URL and storage env configured):
 *
 *   pnpm --filter @transformlit/api run db:backfill:downloads
 *
 * Optional positional limit: `... db:backfill:downloads -- 250`.
 * A version whose assets are missing, incomplete, or unverifiable is skipped
 * and reported — it is never fabricated into eligibility.
 */
async function backfill(): Promise<void> {
  const logger = new Logger('BookDownloadBackfill');
  const limitArg = process.argv.find((arg) => /^\d+$/.test(arg));
  const limit = limitArg ? Number(limitArg) : 1000;

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set; refusing to run the download backfill');
  }

  const app = await NestFactory.createApplicationContext(BookDownloadBackfillModule, { logger: ['error', 'warn', 'log'] });
  try {
    const downloads = app.get(BookDownloadService);
    const summary = await downloads.backfillAllIneligible(limit);
    logger.log(
      `Download version backfill complete: examined=${summary.examined} ` +
        `promoted=${summary.promoted.length} skipped=${summary.skipped.length} (limit=${limit})`,
    );
    for (const skipped of summary.skipped) {
      logger.warn(`Skipped unverifiable version bookId=${skipped.bookId} contentVersion=${skipped.contentVersion}`);
    }
    if (summary.skipped.length > 0) {
      logger.warn(
        'Skipped versions remain ineligible and unavailable for download. ' +
          'Restore their stored assets and rerun, or reprocess the book; checksums and text are never fabricated.',
      );
    }
  } finally {
    await app.close();
  }
}

backfill().catch((error: unknown) => {
  console.error('Book download version backfill failed', error);
  process.exitCode = 1;
});
