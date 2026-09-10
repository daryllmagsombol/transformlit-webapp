import { Module } from '@nestjs/common';
import { BooksService } from './books.service.js';
import { BooksResolver } from './books.resolver.js';
import { AuthModule } from '../auth/auth.module.js';
import { AzureModule } from '../azure/azure.module.js';
import { ConversionModule } from './conversion/conversion.module.js';

@Module({
  imports: [AuthModule, AzureModule, ConversionModule],
  providers: [BooksService, BooksResolver],
  exports: [BooksService],
})
export class BooksModule {}
