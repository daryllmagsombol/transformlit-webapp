import { Module } from '@nestjs/common';

@Module({
  providers: [],
  exports: [],
})
export class AzureModule {}

export { BlobService } from './blob.service.js';
export { EmailService } from './email.service.js';
