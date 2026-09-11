import { Module } from '@nestjs/common';
import { BooksService } from './books.service.js';
import { BooksResolver } from './books.resolver.js';
import { BooksController } from './books.controller.js';
import { ReaderSessionService } from './reader-session.service.js';
import { PageViewService } from './page-view.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AzureModule } from '../azure/azure.module.js';
import { ConversionModule } from './conversion/conversion.module.js';

@Module({
  imports: [AuthModule, AzureModule, ConversionModule],
  controllers: [BooksController],
  providers: [BooksService, BooksResolver, ReaderSessionService, PageViewService],
  exports: [BooksService],
})
export class BooksModule {}
