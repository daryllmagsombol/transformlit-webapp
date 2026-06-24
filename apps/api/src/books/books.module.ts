import { Module } from '@nestjs/common';
import { BooksService } from './books.service.js';
import { BooksResolver } from './books.resolver.js';
import { AuthModule } from '../auth/auth.module.js';
import { AzureModule } from '../azure/azure.module.js';

@Module({
  imports: [AuthModule, AzureModule],
  providers: [BooksService, BooksResolver],
  exports: [BooksService],
})
export class BooksModule {}
