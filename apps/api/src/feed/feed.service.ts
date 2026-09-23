import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@transformlit/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PublishAnnouncementInput,
  UpdateAnnouncementInput,
} from './models/feed.model.js';

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnnouncements() {
    return this.prisma.announcement.findMany({
      where: {
        deletedAt: null,
        status: 'PUBLISHED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { publishAt: { sort: 'desc', nulls: 'last' } },
      take: 50,
    });
  }

  async getAnnouncement(id: string, actorId?: string, actorRole?: UserRole) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) return null;
    const isStaff =
      actorRole === UserRole.ADMIN || actorRole === UserRole.MODERATOR;
    const isOwner = announcement.createdById === actorId;
    if (announcement.status !== 'PUBLISHED' && !isStaff && !isOwner) {
      return null;
    }
    return announcement;
  }

  async createAnnouncement(input: PublishAnnouncementInput, userId: string) {
    return this.prisma.announcement.create({
      data: {
        ...input,
        publishAt: input.publishAt ? new Date(input.publishAt) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        createdById: userId,
      },
    });
  }

  async updateAnnouncement(
    id: string,
    input: UpdateAnnouncementInput,
    actorId: string,
    actorRole: UserRole,
  ) {
    await this.assertCanManageAnnouncement(id, actorId, actorRole);
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...input,
        publishAt: input.publishAt ? new Date(input.publishAt) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      },
    });
  }

  async publishAnnouncement(id: string, userId: string, actorRole: UserRole) {
    await this.assertCanManageAnnouncement(id, userId, actorRole);
    const isStaff = actorRole === UserRole.ADMIN || actorRole === UserRole.MODERATOR;
    if (!isStaff) {
      throw new ForbiddenException('Only staff can publish');
    }
    return this.prisma.announcement.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: userId },
    });
  }

  async unpublishAnnouncement(id: string, actorId: string, actorRole: UserRole) {
    await this.assertCanManageAnnouncement(id, actorId, actorRole);
    return this.prisma.announcement.update({
      where: { id },
      data: { status: 'DRAFT', publishedAt: null },
    });
  }

  async deleteAnnouncement(id: string, actorId: string, actorRole: UserRole) {
    await this.assertCanManageAnnouncement(id, actorId, actorRole);
    return this.prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async assertCanManageAnnouncement(
    id: string,
    actorId: string,
    actorRole: UserRole,
  ) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');

    const isStaff =
      actorRole === UserRole.ADMIN || actorRole === UserRole.MODERATOR;
    const isOwner = announcement.createdById === actorId;
    if (!isStaff && !isOwner) {
      throw new ForbiddenException('You do not have permission to modify this announcement');
    }
    return announcement;
  }

  async getVerseOfDay() {
    // Compute "today" in UTC+8 (e.g., Asia/Manila)
    // UTC+8 midnight = 4 PM UTC on the previous calendar day in UTC terms
    const now = new Date();
    const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const baseUTC = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    );
    const verseDate = new Date(baseUTC - 8 * 60 * 60 * 1000);

    // Check cache first
    const cached = await this.prisma.verseOfTheDay.findUnique({
      where: { date: verseDate },
    });
    if (cached) return cached;

    // Fetch from Our Manna API (no API key required)
    try {
      const res = await fetch(
        'https://beta.ourmanna.com/api/v1/get?format=json&order=daily',
        { headers: { accept: 'application/json' } },
      );
      const data = (await res.json()) as any;
      const details = data.verse?.details;
      const text = details?.text ?? 'Verse unavailable';
      const reference = details?.reference ?? '';
      const version = details?.version ?? 'NIV';

      const verse = await this.prisma.verseOfTheDay.create({
        data: { date: verseDate, text, reference, version },
      });
      return verse;
    } catch {
      // Fallback — return a static verse to avoid empty UI
      return {
        date: verseDate.toISOString(),
        text: '"The heart of man plans his way, but the Lord establishes his steps."',
        reference: 'Proverbs 16:9',
        version: 'ESV',
      };
    }
  }
}
