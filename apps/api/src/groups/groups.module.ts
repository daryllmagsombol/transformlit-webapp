import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { GroupsResolver } from './groups.resolver.js';
import { GroupPostsService } from './group-posts.service.js';
import { GroupPostsResolver } from './group-posts.resolver.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [GroupsService, GroupsResolver, GroupPostsService, GroupPostsResolver],
  exports: [GroupsService],
})
export class GroupsModule {}
