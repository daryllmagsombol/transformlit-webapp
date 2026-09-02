import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
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
  async announcement(@Args('id') id: string) {
    return this.feedService.getAnnouncement(id);
  }

  @Mutation(() => Announcement, { name: 'createAnnouncement' })
  @UseGuards(JwtAuthGuard)
  async createAnnouncement(
    @CurrentUser() user: { id: string },
    @Args('input') input: PublishAnnouncementInput,
  ) {
    return this.feedService.createAnnouncement(input, user.id);
  }

  @Mutation(() => Announcement, { name: 'updateAnnouncement' })
  @UseGuards(JwtAuthGuard)
  async updateAnnouncement(
    @Args('id') id: string,
    @Args('input') input: UpdateAnnouncementInput,
  ) {
    return this.feedService.updateAnnouncement(id, input);
  }

  @Mutation(() => Announcement, { name: 'publishAnnouncement' })
  @UseGuards(JwtAuthGuard)
  async publishAnnouncement(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
  ) {
    return this.feedService.publishAnnouncement(id, user.id);
  }

  @Mutation(() => Announcement, { name: 'unpublishAnnouncement' })
  @UseGuards(JwtAuthGuard)
  async unpublishAnnouncement(@Args('id') id: string) {
    return this.feedService.unpublishAnnouncement(id);
  }

  @Mutation(() => Boolean, { name: 'deleteAnnouncement' })
  @UseGuards(JwtAuthGuard)
  async deleteAnnouncement(@Args('id') id: string) {
    await this.feedService.deleteAnnouncement(id);
    return true;
  }

  @Query(() => VerseOfDay, { name: 'verseOfDay' })
  async verseOfDay() {
    return this.feedService.getVerseOfDay();
  }
}
