import { Module } from '@nestjs/common';
import { ProgressService } from './progress.service.js';
import { StreakService } from './streak.service.js';
import { ProgressResolver } from './progress.resolver.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [ProgressService, StreakService, ProgressResolver],
  exports: [ProgressService],
})
export class ProgressModule {}
