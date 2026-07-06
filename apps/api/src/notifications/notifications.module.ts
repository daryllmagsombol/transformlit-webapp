import { Module, forwardRef } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsResolver } from './notifications.resolver.js';
import { PubSubService } from './notifications.pubsub.js';
import { AuthModule } from '../auth/auth.module.js';
import { FriendsModule } from '../friends/friends.module.js';

@Module({
  imports: [AuthModule, forwardRef(() => FriendsModule)],
  providers: [NotificationsService, NotificationsResolver, PubSubService],
  exports: [NotificationsService, PubSubService],
})
export class NotificationsModule {}
