/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common';
import { AdminAnalyticsService } from './admin-analytics.service.js';

interface PrismaMock {
  user: { count: jest.Mock };
  book: { count: jest.Mock; findUnique: jest.Mock };
  announcement: { count: jest.Mock };
  group: { count: jest.Mock };
  pageView: { findMany: jest.Mock; count: jest.Mock };
  bookProgress: { findMany: jest.Mock };
}

function makePrisma(): PrismaMock {
  return {
    user: { count: jest.fn() },
    book: { count: jest.fn(), findUnique: jest.fn() },
    announcement: { count: jest.fn() },
    group: { count: jest.fn() },
    pageView: { findMany: jest.fn(), count: jest.fn() },
    bookProgress: { findMany: jest.fn() },
  };
}

describe('AdminAnalyticsService', () => {
  describe('platformOverview', () => {
    it('scopes every count to live, status-specific rows', async () => {
      const prisma = makePrisma();
      prisma.user.count
        .mockResolvedValueOnce(12) // totalUsers
        .mockResolvedValueOnce(9) // activeUsers
        .mockResolvedValueOnce(3); // suspendedUsers
      prisma.book.count
        .mockResolvedValueOnce(20) // totalBooks
        .mockResolvedValueOnce(15); // publishedBooks
      prisma.announcement.count.mockResolvedValue(4);
      prisma.group.count.mockResolvedValue(7);

      const service = new AdminAnalyticsService(prisma as never);
      const result = await service.platformOverview();

      expect(result).toEqual({
        totalUsers: 12,
        activeUsers: 9,
        suspendedUsers: 3,
        totalBooks: 20,
        publishedBooks: 15,
        publishedAnnouncements: 4,
        totalGroups: 7,
      });

      // Real query shapes: soft-deleted rows excluded everywhere.
      expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
        where: { deletedAt: null },
      });
      expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
        where: { status: 'ACTIVE', deletedAt: null },
      });
      expect(prisma.user.count).toHaveBeenNthCalledWith(3, {
        where: { status: 'SUSPENDED', deletedAt: null },
      });
      expect(prisma.book.count).toHaveBeenNthCalledWith(1, {
        where: { deletedAt: null },
      });
      expect(prisma.book.count).toHaveBeenNthCalledWith(2, {
        where: { status: 'PUBLISHED', deletedAt: null },
      });
      expect(prisma.announcement.count).toHaveBeenCalledWith({
        where: { status: 'PUBLISHED', deletedAt: null },
      });
      expect(prisma.group.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });
    });
  });

  describe('bookStats', () => {
    it('counts distinct readers and completers from real query shapes', async () => {
      const prisma = makePrisma();
      prisma.book.findUnique.mockResolvedValue({ id: 'book-1', title: 'Dune' });
      prisma.pageView.findMany.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      prisma.bookProgress.findMany.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);
      prisma.pageView.count.mockResolvedValue(37);

      const service = new AdminAnalyticsService(prisma as never);
      const result = await service.bookStats('book-1');

      expect(prisma.book.findUnique).toHaveBeenCalledWith({
        where: { id: 'book-1', deletedAt: null },
        select: { id: true, title: true },
      });
      expect(prisma.pageView.findMany).toHaveBeenCalledWith({
        where: { bookId: 'book-1' },
        distinct: ['userId'],
        select: { userId: true },
      });
      expect(prisma.bookProgress.findMany).toHaveBeenCalledWith({
        where: { bookId: 'book-1', completedAt: { not: null } },
        distinct: ['userId'],
        select: { userId: true },
      });
      expect(prisma.pageView.count).toHaveBeenCalledWith({
        where: { bookId: 'book-1' },
      });

      expect(result).toEqual({
        bookId: 'book-1',
        title: 'Dune',
        readers: 3,
        completed: 2,
        completionRate: 67,
        totalPageViews: 37,
        avgPagesPerReader: 12,
      });
    });

    it('rounds completion rate and average pages to integers', async () => {
      const prisma = makePrisma();
      prisma.book.findUnique.mockResolvedValue({ id: 'book-2', title: 'X' });
      prisma.pageView.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.bookProgress.findMany.mockResolvedValue([]);
      prisma.pageView.count.mockResolvedValue(2);

      const service = new AdminAnalyticsService(prisma as never);
      const result = await service.bookStats('book-2');

      expect(result.completionRate).toBe(0);
      expect(result.avgPagesPerReader).toBe(2);
      expect(Number.isInteger(result.completionRate)).toBe(true);
      expect(Number.isInteger(result.avgPagesPerReader)).toBe(true);
    });

    it('guards division when there are no readers', async () => {
      const prisma = makePrisma();
      prisma.book.findUnique.mockResolvedValue({ id: 'book-3', title: 'Empty' });
      prisma.pageView.findMany.mockResolvedValue([]);
      prisma.bookProgress.findMany.mockResolvedValue([]);
      prisma.pageView.count.mockResolvedValue(0);

      const service = new AdminAnalyticsService(prisma as never);
      const result = await service.bookStats('book-3');

      expect(result.readers).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.avgPagesPerReader).toBe(0);
    });

    it('intersects completers with readers so completed cannot exceed readers', async () => {
      const prisma = makePrisma();
      prisma.book.findUnique.mockResolvedValue({ id: 'book-4', title: 'Sync' });
      prisma.pageView.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.bookProgress.findMany.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'ghost' },
      ]);
      prisma.pageView.count.mockResolvedValue(3);

      const service = new AdminAnalyticsService(prisma as never);
      const result = await service.bookStats('book-4');

      expect(result.readers).toBe(1);
      expect(result.completed).toBe(1);
      expect(result.completionRate).toBe(100);
    });

    it('throws NotFoundException when the book does not exist', async () => {
      const prisma = makePrisma();
      prisma.book.findUnique.mockResolvedValue(null);

      const service = new AdminAnalyticsService(prisma as never);

      await expect(service.bookStats('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.pageView.findMany).not.toHaveBeenCalled();
    });
  });
});
