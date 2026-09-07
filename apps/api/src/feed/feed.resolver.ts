import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserRole } from '@transformlit/shared';
import { FeedService } from './feed.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Announcement, VerseOfDay, PublishAnnouncementInput, UpdateAnnouncementInput } from './models/feed.model.js';

@Resolver()
export class FeedResolver {
  constructor(private readonly feedService: FeedService) {}

  @Query(() => [Announcement], { name: 'announcements' })
  @UseGuards(JwtAuthGuard)
  async announcements() {
    return this.feedService.getAnnouncements();
  }

  @Query(() => Announcement, { name: 'announcement', nullable: true })
  @UseGuards(JwtAuthGuard)
  async announcement(
    @Args('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.feedService.getAnnouncement(id, user.id, user.role);
  }

  @Mutation(() => Announcement, { name: 'createAnnouncement' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async createAnnouncement(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('input') input: PublishAnnouncementInput,
  ) {
    return this.feedService.createAnnouncement(input, user.id);
  }

  @Mutation(() => Announcement, { name: 'updateAnnouncement' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async updateAnnouncement(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('id') id: string,
    @Args('input') input: UpdateAnnouncementInput,
  ) {
    return this.feedService.updateAnnouncement(id, input, user.id, user.role);
  }

  @Mutation(() => Announcement, { name: 'publishAnnouncement' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async publishAnnouncement(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('id') id: string,
  ) {
    return this.feedService.publishAnnouncement(id, user.id, user.role);
  }

  @Mutation(() => Announcement, { name: 'unpublishAnnouncement' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async unpublishAnnouncement(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('id') id: string,
  ) {
    return this.feedService.unpublishAnnouncement(id, user.id, user.role);
  }

  @Mutation(() => Boolean, { name: 'deleteAnnouncement' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  async deleteAnnouncement(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('id') id: string,
  ) {
    await this.feedService.deleteAnnouncement(id, user.id, user.role);
    return true;
  }

  @Query(() => VerseOfDay, { name: 'verseOfDay' })
  async verseOfDay() {
    return this.feedService.getVerseOfDay();
  }
}
