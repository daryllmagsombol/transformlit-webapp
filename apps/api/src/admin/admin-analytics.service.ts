import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Aggregate counters across the whole platform. */
export interface PlatformOverview {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  totalBooks: number;
  publishedBooks: number;
  publishedAnnouncements: number;
  totalGroups: number;
}

/** Per-book engagement aggregates. */
export interface BookStats {
  bookId: string;
  title: string;
  readers: number;
  completed: number;
  completionRate: number;
  totalPageViews: number;
  avgPagesPerReader: number;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Platform-wide row counts, excluding soft-deleted rows. */
  async platformOverview(): Promise<PlatformOverview> {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalBooks,
      publishedBooks,
      publishedAnnouncements,
      totalGroups,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.user.count({
        where: { status: 'SUSPENDED', deletedAt: null },
      }),
      this.prisma.book.count({ where: { deletedAt: null } }),
      this.prisma.book.count({
        where: { status: 'PUBLISHED', deletedAt: null },
      }),
      this.prisma.announcement.count({
        where: { status: 'PUBLISHED', deletedAt: null },
      }),
      this.prisma.group.count({ where: { deletedAt: null } }),
    ]);

    return {
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalBooks,
      publishedBooks,
      publishedAnnouncements,
      totalGroups,
    };
  }

  /**
   * Engagement for one book. `readers` counts distinct users with a page view;
   * `completed` counts distinct users whose progress row has a completion time
   * **intersected with the reader set**, so it can never exceed `readers`.
   * `BookProgress` is written by the offline `PROGRESS_SET` sync path and has no
   * FK to `PageView`, so a completer with no recorded view is excluded here.
   * Rates are integer-rounded and never divide by zero.
   */
  async bookStats(bookId: string): Promise<BookStats> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!book) throw new NotFoundException('Book not found');

    const [readerRows, completedRows, totalPageViews] = await Promise.all([
      this.prisma.pageView.findMany({
        where: { bookId },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.bookProgress.findMany({
        where: { bookId, completedAt: { not: null } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.pageView.count({ where: { bookId } }),
    ]);

    const readers = readerRows.length;
    const readerIds = new Set(readerRows.map((row) => row.userId));
    const completed = completedRows.filter((row) =>
      readerIds.has(row.userId),
    ).length;
    const completionRate = this.percentage(completed, readers);
    const avgPagesPerReader = this.roundedRatio(totalPageViews, readers);

    return {
      bookId: book.id,
      title: book.title,
      readers,
      completed,
      completionRate,
      totalPageViews,
      avgPagesPerReader,
    };
  }

  /** `part / whole` as a percentage clamped to 0..100, 0 when `whole` is 0. */
  private percentage(part: number, whole: number): number {
    if (whole <= 0) return 0;
    const value = Math.round((part / whole) * 100);
    return Math.min(Math.max(value, 0), 100);
  }

  /** Integer-rounded ratio, 0 when the denominator is 0. */
  private roundedRatio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round(numerator / denominator);
  }
}
