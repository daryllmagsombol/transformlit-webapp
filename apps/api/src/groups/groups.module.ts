import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { GroupsResolver } from './groups.resolver.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [GroupsService, GroupsResolver],
  exports: [GroupsService],
})
export class GroupsModule {}
