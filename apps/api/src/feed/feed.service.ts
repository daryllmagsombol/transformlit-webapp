import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PublishAnnouncementInput,
  UpdateAnnouncementInput,
} from '@transformlit/shared';

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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

  async getAnnouncement(id: string) {
    return this.prisma.announcement.findUnique({ where: { id } });
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

  async updateAnnouncement(id: string, input: UpdateAnnouncementInput) {
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...input,
        publishAt: input.publishAt ? new Date(input.publishAt) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      },
    });
  }

  async publishAnnouncement(id: string, userId: string) {
    return this.prisma.announcement.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: userId },
    });
  }

  async unpublishAnnouncement(id: string) {
    return this.prisma.announcement.update({
      where: { id },
      data: { status: 'DRAFT', publishedAt: null },
    });
  }

  async deleteAnnouncement(id: string) {
    return this.prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getVerseOfDay() {
    // Check cache first
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const cached = await this.prisma.verseOfTheDay.findUnique({
      where: { date: today },
    });
    if (cached) return cached;

    // Fetch from Our Manna API
    const apiKey = this.config.get<string>('VERSE_API_KEY');
    if (!apiKey) {
      return { date: today.toISOString(), text: 'John 3:16 — For God so loved the world...', reference: 'John 3:16', version: 'KJV' };
    }

    try {
      const res = await fetch(`https://api.ourmanna.com/api/v1/get?format=json`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json() as any;
      const text = data.verse?.details?.text ?? data.detail ?? 'Verse unavailable';
      const reference = data.verse?.details?.reference ?? '';
      const verse = await this.prisma.verseOfTheDay.create({
        data: { date: today, text, reference, version: 'KJV' },
      });
      return verse;
    } catch {
      return { date: today.toISOString(), text: 'Verse unavailable', reference: '', version: 'KJV' };
    }
  }
}
