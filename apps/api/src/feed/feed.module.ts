import { Module } from '@nestjs/common';
import { FeedService } from './feed.service.js';
import { FeedResolver } from './feed.resolver.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [FeedService, FeedResolver],
  exports: [FeedService],
})
export class FeedModule {}
