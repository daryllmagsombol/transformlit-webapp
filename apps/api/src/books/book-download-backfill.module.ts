import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AzureModule } from '../azure/azure.module.js';
import { BooksService } from './books.service.js';
import {
  BookDownloadService,
  DOWNLOAD_CONCURRENCY_LIMITER,
  DOWNLOAD_CONCURRENCY_LIMIT,
  DownloadConcurrencyLimiter,
} from './book-download.service.js';

/**
 * Minimal, HTTP-free graph for the one-shot download-version backfill script.
 * Deliberately excludes AuthModule/GraphQL/throttling so the operator command
 * runs without a web server, JWT secret, or route configuration.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, StorageModule, AzureModule],
  providers: [
    BooksService,
    BookDownloadService,
    {
      provide: DOWNLOAD_CONCURRENCY_LIMITER,
      useFactory: () => new DownloadConcurrencyLimiter(DOWNLOAD_CONCURRENCY_LIMIT),
    },
  ],
})
export class BookDownloadBackfillModule {}
