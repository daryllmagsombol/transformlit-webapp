import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { ReadingPlansService } from './reading-plans.service.js';
import { SharedHighlightsService } from './shared-highlights.service.js';
import { GroupFeaturesResolver } from './group-features.resolver.js';

@Module({
  imports: [AuthModule, GroupsModule],
  providers: [ReadingPlansService, SharedHighlightsService, GroupFeaturesResolver],
})
export class GroupFeaturesModule {}
