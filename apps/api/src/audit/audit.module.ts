import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Global so any domain can inject `AuditService` without importing another
 * domain module (precedent: PrismaModule / StorageModule).
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
