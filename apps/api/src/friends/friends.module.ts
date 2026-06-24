import { Module } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { FriendsResolver } from './friends.resolver.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  providers: [FriendsService, FriendsResolver],
  exports: [FriendsService],
})
export class FriendsModule {}
