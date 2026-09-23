/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@transformlit/shared';
import { FeedService } from './feed.service';
import { PrismaService } from '../prisma/prisma.service';

const mockAnnouncement = {
  id: 'ann-1',
  title: 'Test Announcement',
  body: 'Body text',
  status: 'PUBLISHED',
  category: 'GENERAL',
  publishAt: new Date('2024-06-01'),
  expiresAt: null,
  publishedAt: new Date('2024-06-01'),
  publishedById: 'user-1',
  createdById: 'user-1',
  createdAt: new Date('2024-06-01'),
  deletedAt: null,
};

const mockVerse = {
  id: 'verse-1',
  date: new Date('2024-06-15'),
  text: '"A man\'s heart plans his way, but the Lord directs his steps."',
  reference: 'Proverbs 16:9',
  version: 'ESV',
};

describe('FeedService', () => {
  let service: FeedService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrisma = {
      announcement: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(mockAnnouncement),
        create: jest.fn().mockResolvedValue(mockAnnouncement),
        update: jest.fn().mockResolvedValue(mockAnnouncement),
      },
      verseOfTheDay: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockVerse),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();

    prisma.announcement.findMany.mockResolvedValue([]);
    prisma.announcement.findUnique.mockResolvedValue(mockAnnouncement);
    prisma.announcement.create.mockResolvedValue(mockAnnouncement);
    prisma.announcement.update.mockResolvedValue(mockAnnouncement);
    prisma.verseOfTheDay.findUnique.mockResolvedValue(null);
    prisma.verseOfTheDay.create.mockResolvedValue(mockVerse);
  });

  // ── getAnnouncements ──────────────────────────────────────────────────────

  describe('getAnnouncements', () => {
    it('should find where deletedAt null and status PUBLISHED', async () => {
      await service.getAnnouncements();
      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            status: 'PUBLISHED',
          }),
        }),
      );
    });

    it('should filter by expiresAt null OR expiresAt > now', async () => {
      await service.getAnnouncements();
      const call = prisma.announcement.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { expiresAt: null },
        { expiresAt: { gt: expect.any(Date) } },
      ]);
    });

    it('should order by publishAt desc nulls last', async () => {
      await service.getAnnouncements();
      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { publishAt: { sort: 'desc', nulls: 'last' } },
        }),
      );
    });

    it('should limit to 50', async () => {
      await service.getAnnouncements();
      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should return announcements array', async () => {
      const announcements = [mockAnnouncement];
      prisma.announcement.findMany.mockResolvedValue(announcements);
      const result = await service.getAnnouncements();
      expect(result).toEqual(announcements);
    });
  });

  // ── getAnnouncement ───────────────────────────────────────────────────────

  describe('getAnnouncement', () => {
    it('should find by id', async () => {
      await service.getAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      expect(prisma.announcement.findUnique).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
      });
    });

    it('should return the announcement if found', async () => {
      const result = await service.getAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should return null if not found', async () => {
      prisma.announcement.findUnique.mockResolvedValue(null);
      const result = await service.getAnnouncement('bad-id', 'user-1', UserRole.ADMIN);
      expect(result).toBeNull();
    });

    it('should return PUBLISHED announcement to any authenticated member', async () => {
      const result = await service.getAnnouncement('ann-1', 'user-2', UserRole.MEMBER);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should hide a non-PUBLISHED announcement from a member', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...mockAnnouncement,
        status: 'DRAFT',
      });
      const result = await service.getAnnouncement('ann-1', 'user-2', UserRole.MEMBER);
      expect(result).toBeNull();
    });

    it('should allow the draft owner to read their own draft', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...mockAnnouncement,
        status: 'DRAFT',
      });
      const result = await service.getAnnouncement('ann-1', 'user-1', UserRole.MEMBER);
      expect(result).toEqual({ ...mockAnnouncement, status: 'DRAFT' });
    });

    it('should allow staff to read non-PUBLISHED announcements', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...mockAnnouncement,
        status: 'DRAFT',
      });
      const result = await service.getAnnouncement('ann-1', 'user-2', UserRole.MODERATOR);
      expect(result).toEqual({ ...mockAnnouncement, status: 'DRAFT' });
    });
  });

  // ── createAnnouncement ────────────────────────────────────────────────────

  describe('createAnnouncement', () => {
    const input = {
      title: 'New Announcement',
      body: 'New body',
      publishAt: '2024-06-01T00:00:00.000Z',
      expiresAt: '2024-12-31T00:00:00.000Z',
    };

    it('should convert publishAt from string to Date', async () => {
      await service.createAnnouncement(input, 'user-1');
      const call = prisma.announcement.create.mock.calls[0][0];
      expect(call.data.publishAt).toBeInstanceOf(Date);
    });

    it('should convert expiresAt from string to Date', async () => {
      await service.createAnnouncement(input, 'user-1');
      const call = prisma.announcement.create.mock.calls[0][0];
      expect(call.data.expiresAt).toBeInstanceOf(Date);
    });

    it('should set createdById', async () => {
      await service.createAnnouncement(input, 'user-1');
      const call = prisma.announcement.create.mock.calls[0][0];
      expect(call.data.createdById).toBe('user-1');
    });

    it('should return created announcement', async () => {
      const result = await service.createAnnouncement(input, 'user-1');
      expect(result).toEqual(mockAnnouncement);
    });

    it('should handle undefined publishAt and expiresAt', async () => {
      const minimalInput = { title: 'Test', body: 'Body' };
      await service.createAnnouncement(minimalInput, 'user-1');
      const call = prisma.announcement.create.mock.calls[0][0];
      expect(call.data.publishAt).toBeUndefined();
      expect(call.data.expiresAt).toBeUndefined();
    });
  });

  // ── updateAnnouncement ────────────────────────────────────────────────────

  describe('updateAnnouncement', () => {
    const input = {
      title: 'Updated Title',
      publishAt: '2024-07-01T00:00:00.000Z',
      expiresAt: '2024-12-31T00:00:00.000Z',
    };

    it('should convert date strings to Date objects', async () => {
      await service.updateAnnouncement('ann-1', input, 'user-1', UserRole.MEMBER);
      const call = prisma.announcement.update.mock.calls[0][0];
      expect(call.data.publishAt).toBeInstanceOf(Date);
      expect(call.data.expiresAt).toBeInstanceOf(Date);
    });

    it('should update announcement by id', async () => {
      await service.updateAnnouncement('ann-1', input, 'user-1', UserRole.MEMBER);
      expect(prisma.announcement.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ann-1' } }),
      );
    });

    it('should return updated announcement', async () => {
      const updated = { ...mockAnnouncement, title: 'Updated Title' };
      prisma.announcement.update.mockResolvedValue(updated);
      const result = await service.updateAnnouncement('ann-1', input, 'user-1', UserRole.MEMBER);
      expect(result).toEqual(updated);
    });

    it('should allow staff to update an announcement they did not create', async () => {
      const result = await service.updateAnnouncement('ann-1', input, 'user-2', UserRole.ADMIN);
      expect(result).toEqual(mockAnnouncement);
      expect(prisma.announcement.update).toHaveBeenCalled();
    });

    it('should allow the draft creator to update their own announcement', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...mockAnnouncement,
        status: 'DRAFT',
      });
      const result = await service.updateAnnouncement('ann-1', input, 'user-1', UserRole.MEMBER);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should throw NotFoundException if announcement does not exist', async () => {
      prisma.announcement.findUnique.mockResolvedValue(null);
      await expect(
        service.updateAnnouncement('bad-id', input, 'user-1', UserRole.ADMIN),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for a member who is not the creator', async () => {
      prisma.announcement.findUnique.mockResolvedValue({
        ...mockAnnouncement,
        createdById: 'user-1',
      });
      await expect(
        service.updateAnnouncement('ann-1', input, 'user-2', UserRole.MEMBER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });
  });

  // ── publishAnnouncement ───────────────────────────────────────────────────

  describe('publishAnnouncement', () => {
    it('should set status to PUBLISHED', async () => {
      await service.publishAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      const call = prisma.announcement.update.mock.calls[0][0];
      expect(call.data.status).toBe('PUBLISHED');
    });

    it('should set publishedAt to a Date', async () => {
      await service.publishAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      const call = prisma.announcement.update.mock.calls[0][0];
      expect(call.data.publishedAt).toBeInstanceOf(Date);
    });

    it('should set publishedById to userId', async () => {
      await service.publishAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      const call = prisma.announcement.update.mock.calls[0][0];
      expect(call.data.publishedById).toBe('user-1');
    });

    it('should return updated announcement', async () => {
      const result = await service.publishAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should allow a moderator to publish', async () => {
      const result = await service.publishAnnouncement('ann-1', 'user-1', UserRole.MODERATOR);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should throw ForbiddenException when a member tries to publish', async () => {
      await expect(
        service.publishAnnouncement('ann-1', 'user-1', UserRole.MEMBER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException with "Only staff can publish"', async () => {
      await expect(
        service.publishAnnouncement('ann-1', 'user-1', UserRole.MEMBER),
      ).rejects.toThrow('Only staff can publish');
    });
  });

  // ── unpublishAnnouncement ─────────────────────────────────────────────────

  describe('unpublishAnnouncement', () => {
    it('should set status to DRAFT', async () => {
      await service.unpublishAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      const call = prisma.announcement.update.mock.calls[0][0];
      expect(call.data.status).toBe('DRAFT');
    });

    it('should set publishedAt to null', async () => {
      await service.unpublishAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      const call = prisma.announcement.update.mock.calls[0][0];
      expect(call.data.publishedAt).toBeNull();
    });

    it('should return updated announcement', async () => {
      const result = await service.unpublishAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should allow the creator to unpublish their own announcement', async () => {
      const result = await service.unpublishAnnouncement('ann-1', 'user-1', UserRole.MEMBER);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should throw ForbiddenException for a member who is not the creator', async () => {
      await expect(
        service.unpublishAnnouncement('ann-1', 'user-2', UserRole.MEMBER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });
  });

  // ── deleteAnnouncement ────────────────────────────────────────────────────

  describe('deleteAnnouncement', () => {
    it('should soft delete by setting deletedAt', async () => {
      await service.deleteAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
    });

    it('should return updated announcement', async () => {
      const deleted = { ...mockAnnouncement, deletedAt: new Date() };
      prisma.announcement.update.mockResolvedValue(deleted);
      const result = await service.deleteAnnouncement('ann-1', 'user-1', UserRole.ADMIN);
      expect(result).toEqual(deleted);
    });

    it('should allow a moderator to delete', async () => {
      const result = await service.deleteAnnouncement('ann-1', 'user-2', UserRole.MODERATOR);
      expect(result).toEqual(mockAnnouncement);
    });

    it('should throw ForbiddenException for a member who is not the creator', async () => {
      await expect(
        service.deleteAnnouncement('ann-1', 'user-2', UserRole.MEMBER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });
  });

  // ── getVerseOfDay ─────────────────────────────────────────────────────────

  describe('getVerseOfDay', () => {
    let fetchSpy: jest.SpyInstance;

    afterEach(() => {
      if (fetchSpy) fetchSpy.mockRestore();
    });

    it('should check cache by verseDate', async () => {
      await service.getVerseOfDay();
      expect(prisma.verseOfTheDay.findUnique).toHaveBeenCalledWith({
        where: { date: expect.any(Date) },
      });
    });

    it('should return cached verse if found', async () => {
      prisma.verseOfTheDay.findUnique.mockResolvedValue(mockVerse);
      const result = await service.getVerseOfDay();
      expect(result).toEqual(mockVerse);
    });

    it('should not fetch from API if cached', async () => {
      prisma.verseOfTheDay.findUnique.mockResolvedValue(mockVerse);
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({}),
      } as any);
      await service.getVerseOfDay();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should fetch from external API if not cached', async () => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({
          verse: {
            details: {
              text: 'Test verse text',
              reference: 'John 3:16',
              version: 'NIV',
            },
          },
        }),
      } as any);

      await service.getVerseOfDay();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://beta.ourmanna.com/api/v1/get?format=json&order=daily',
        { headers: { accept: 'application/json' } },
      );
    });

    it('should cache fetched verse in DB', async () => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({
          verse: {
            details: {
              text: 'Test verse text',
              reference: 'John 3:16',
              version: 'NIV',
            },
          },
        }),
      } as any);

      await service.getVerseOfDay();
      expect(prisma.verseOfTheDay.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          text: 'Test verse text',
          reference: 'John 3:16',
          version: 'NIV',
          date: expect.any(Date),
        }),
      });
    });

    it('should return cached verse from DB after fetch', async () => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({
          verse: {
            details: {
              text: 'Test verse text',
              reference: 'John 3:16',
              version: 'NIV',
            },
          },
        }),
      } as any);

      const result = await service.getVerseOfDay();
      expect(result).toEqual(mockVerse);
    });

    it('should return static fallback on fetch failure', async () => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await service.getVerseOfDay();
      expect(result).toEqual(
        expect.objectContaining({
          text: '"The heart of man plans his way, but the Lord establishes his steps."',
          reference: 'Proverbs 16:9',
          version: 'ESV',
        }),
      );
    });

    it('should include date in fallback', async () => {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await service.getVerseOfDay();
      expect(result.date).toBeDefined();
    });
  });
});
