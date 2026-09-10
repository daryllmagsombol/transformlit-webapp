import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { STORAGE_ADAPTER } from './storage-adapter.js';
import { LocalStorageAdapter } from './local-storage.adapter.js';

export const DEFAULT_BOOK_STORAGE_DIR = '.book-storage';

export function resolveStorageDir(config: ConfigService): string {
  return config.get<string>('BOOK_STORAGE_DIR') ?? join(process.cwd(), DEFAULT_BOOK_STORAGE_DIR);
}

/**
 * Global so every module resolves the same adapter without re-importing.
 * Tests override STORAGE_ADAPTER with a temp dir.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new LocalStorageAdapter(resolveStorageDir(config)),
    },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
