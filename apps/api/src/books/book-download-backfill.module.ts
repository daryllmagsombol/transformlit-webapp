import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AzureModule } from '../azure/azure.module.js';
import { AuditModule } from '../audit/audit.module.js';
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
 *
 * `AuditModule` is imported explicitly even though it is `@Global()`: this
 * module is bootstrapped as its own application-context root, so the global
 * module registered in `AppModule` is not part of this graph. `BooksService`
 * requires `AuditService`, and without this import the operator command would
 * fail to bootstrap rather than silently skip audit writes.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    AzureModule,
    AuditModule,
  ],
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
