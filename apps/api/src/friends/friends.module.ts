import { Module, forwardRef } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { FriendsResolver } from './friends.resolver.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, forwardRef(() => NotificationsModule)],
  providers: [FriendsService, FriendsResolver],
  exports: [FriendsService],
})
export class FriendsModule {}
