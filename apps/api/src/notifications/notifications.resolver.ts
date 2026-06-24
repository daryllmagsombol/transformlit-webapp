import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Notification } from './models/notification.model.js';

@Resolver()
export class NotificationsResolver {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Query(() => [Notification], { name: 'notifications' })
  @UseGuards(JwtAuthGuard)
  async notifications(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, defaultValue: 50 }) limit: number,
  ) {
    return this.notificationsService.listNotifications(user.id, limit);
  }

  @Query(() => Int, { name: 'unreadNotificationCount' })
  @UseGuards(JwtAuthGuard)
  async unreadNotificationCount(@CurrentUser() user: { id: string }) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Mutation(() => Boolean, { name: 'markNotificationRead' })
  @UseGuards(JwtAuthGuard)
  async markNotificationRead(
    @CurrentUser() user: { id: string },
    @Args('notificationId') notificationId: string,
  ) {
    return this.notificationsService.markRead(notificationId, user.id);
  }

  @Mutation(() => Boolean, { name: 'markAllNotificationsRead' })
  @UseGuards(JwtAuthGuard)
  async markAllNotificationsRead(@CurrentUser() user: { id: string }) {
    return this.notificationsService.markAllRead(user.id);
  }
}
