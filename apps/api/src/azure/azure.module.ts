import { Module } from '@nestjs/common';
import { BlobService } from './blob.service.js';
import { EmailService } from './email.service.js';

@Module({
  providers: [BlobService, EmailService],
  exports: [BlobService, EmailService],
})
export class AzureModule {}

export { BlobService } from './blob.service.js';
export { EmailService } from './email.service.js';
