/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { FeedResolver } from './feed.resolver';
import { FeedService } from './feed.service';

const mockAnnouncement = {
  id: 'ann-1',
  title: 'Test Announcement',
  body: 'Body text',
  status: 'PUBLISHED',
  category: 'GENERAL',
  publishAt: new Date('2024-06-01'),
  expiresAt: null,
  publishedAt: new Date('2024-06-01'),
  createdById: 'user-1',
  createdAt: new Date('2024-06-01'),
  deletedAt: null,
};

const mockVerse = {
  date: '2024-06-15T00:00:00.000Z',
  text: '"A man\'s heart plans his way, but the Lord directs his steps."',
  reference: 'Proverbs 16:9',
  version: 'ESV',
};

const mockUser = { id: 'user-1' };

describe('FeedResolver', () => {
  let resolver: FeedResolver;
  let feedService: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockFeedService = {
      getAnnouncements: jest.fn().mockResolvedValue([mockAnnouncement]),
      getAnnouncement: jest.fn().mockResolvedValue(mockAnnouncement),
      getVerseOfDay: jest.fn().mockResolvedValue(mockVerse),
      createAnnouncement: jest.fn().mockResolvedValue(mockAnnouncement),
      updateAnnouncement: jest.fn().mockResolvedValue({ ...mockAnnouncement, title: 'Updated' }),
      publishAnnouncement: jest.fn().mockResolvedValue({ ...mockAnnouncement, status: 'PUBLISHED' }),
      unpublishAnnouncement: jest.fn().mockResolvedValue({ ...mockAnnouncement, status: 'DRAFT' }),
      deleteAnnouncement: jest.fn().mockResolvedValue({ ...mockAnnouncement, deletedAt: new Date() }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedResolver,
        { provide: FeedService, useValue: mockFeedService },
      ],
    }).compile();

    resolver = module.get<FeedResolver>(FeedResolver);
    feedService = module.get(FeedService) as any;
    jest.clearAllMocks();
  });

  // ── announcements query ───────────────────────────────────────────────────

  describe('announcements', () => {
    it('should delegate to getAnnouncements', async () => {
      const result = await resolver.announcements();
      expect(feedService.getAnnouncements).toHaveBeenCalledWith();
      expect(result).toEqual([mockAnnouncement]);
    });
  });

  // ── announcement query ────────────────────────────────────────────────────

  describe('announcement', () => {
    it('should delegate to getAnnouncement with id', async () => {
      const result = await resolver.announcement('ann-1');
      expect(feedService.getAnnouncement).toHaveBeenCalledWith('ann-1');
      expect(result).toEqual(mockAnnouncement);
    });
  });

  // ── verseOfDay query ──────────────────────────────────────────────────────

  describe('verseOfDay', () => {
    it('should delegate to getVerseOfDay', async () => {
      const result = await resolver.verseOfDay();
      expect(feedService.getVerseOfDay).toHaveBeenCalledWith();
      expect(result).toEqual(mockVerse);
    });
  });

  // ── createAnnouncement mutation ───────────────────────────────────────────

  describe('createAnnouncement', () => {
    it('should delegate to createAnnouncement with input and user id', async () => {
      const input = { title: 'New', body: 'Body' };
      const result = await resolver.createAnnouncement(mockUser, input as any);
      expect(feedService.createAnnouncement).toHaveBeenCalledWith(input, 'user-1');
      expect(result).toEqual(mockAnnouncement);
    });
  });

  // ── updateAnnouncement mutation ───────────────────────────────────────────

  describe('updateAnnouncement', () => {
    it('should delegate to updateAnnouncement with id and input', async () => {
      const input = { title: 'Updated' };
      const result = await resolver.updateAnnouncement('ann-1', input as any);
      expect(feedService.updateAnnouncement).toHaveBeenCalledWith('ann-1', input);
      expect(result).toEqual({ ...mockAnnouncement, title: 'Updated' });
    });
  });

  // ── publishAnnouncement mutation ──────────────────────────────────────────

  describe('publishAnnouncement', () => {
    it('should delegate to publishAnnouncement with id and user id', async () => {
      const result = await resolver.publishAnnouncement(mockUser, 'ann-1');
      expect(feedService.publishAnnouncement).toHaveBeenCalledWith('ann-1', 'user-1');
      expect(result).toEqual({ ...mockAnnouncement, status: 'PUBLISHED' });
    });
  });

  // ── unpublishAnnouncement mutation ────────────────────────────────────────

  describe('unpublishAnnouncement', () => {
    it('should delegate to unpublishAnnouncement with id', async () => {
      const result = await resolver.unpublishAnnouncement('ann-1');
      expect(feedService.unpublishAnnouncement).toHaveBeenCalledWith('ann-1');
      expect(result).toEqual({ ...mockAnnouncement, status: 'DRAFT' });
    });
  });

  // ── deleteAnnouncement mutation ───────────────────────────────────────────

  describe('deleteAnnouncement', () => {
    it('should delegate to deleteAnnouncement and return true', async () => {
      const result = await resolver.deleteAnnouncement('ann-1');
      expect(feedService.deleteAnnouncement).toHaveBeenCalledWith('ann-1');
      expect(result).toBe(true);
    });
  });
});
