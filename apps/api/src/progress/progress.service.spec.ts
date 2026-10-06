import { Test, TestingModule } from '@nestjs/testing';
import { ActivityType, GoalKind } from '@transformlit/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProgressService } from './progress.service.js';
import { StreakService } from './streak.service.js';

function p2002(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

describe('ProgressService', () => {
  let service: ProgressService;
  let prisma: any;
  let streaks: {
    computeCurrent: jest.Mock;
    computeLongest: jest.Mock;
    refreshCache: jest.Mock;
  };

  beforeEach(async () => {
    const mockPrisma = {
      activityEvent: { create: jest.fn().mockResolvedValue({}) },
      activityEventReceipt: { create: jest.fn().mockResolvedValue({}) },
      dailyActivityType: { create: jest.fn().mockResolvedValue({}) },
      dailyActivity: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      readingGoal: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      userStreak: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };

    const mockStreaks = {
      computeCurrent: jest.fn(),
      computeLongest: jest.fn(),
      refreshCache: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StreakService, useValue: mockStreaks },
      ],
    }).compile();

    service = module.get<ProgressService>(ProgressService);
    prisma = module.get(PrismaService);
    streaks = module.get(StreakService);
    jest.clearAllMocks();

    prisma.activityEvent.create.mockResolvedValue({});
    prisma.activityEventReceipt.create.mockResolvedValue({});
    prisma.dailyActivityType.create.mockResolvedValue({});
    prisma.dailyActivity.upsert.mockResolvedValue({});
    prisma.dailyActivity.findMany.mockResolvedValue([]);
    prisma.readingGoal.findUnique.mockResolvedValue(null);
    prisma.readingGoal.upsert.mockResolvedValue({
      year: 2026,
      targetKind: 'DAYS',
      targetValue: 24,
    });
    prisma.userStreak.findUnique.mockResolvedValue(null);
    streaks.computeCurrent.mockResolvedValue(0);
    streaks.computeLongest.mockResolvedValue(0);
    streaks.refreshCache.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );
  });

  // ── recordActivity ─────────────────────────────────────────────────────────

  describe('recordActivity', () => {
    it('clamps pagesDelta to at most 1', async () => {
      await service.recordActivity('u1', { type: ActivityType.BOOK_READ, pagesDelta: 999999 });
      const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
      expect(upsert.update.pagesRead.increment).toBe(1);
      expect(prisma.activityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pagesDelta: 1 }) }),
      );
    });

    it('clamps a negative pagesDelta to 0', async () => {
      await service.recordActivity('u1', { type: ActivityType.BOOK_READ, pagesDelta: -5 });
      const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
      expect(upsert.update.pagesRead.increment).toBe(0);
    });

    it('inserts the activity event with a server-computed dayKey and clamps once', async () => {
      const result = await service.recordActivity('u1', {
        type: ActivityType.FEED_READ,
        pagesDelta: 0,
      });
      expect(result.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(prisma.activityEvent.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          type: ActivityType.FEED_READ,
          dayKey: result.dayKey,
          pagesDelta: 0,
        },
      });
    });

    it('returns counted:true and increments activityCount when the type is new today', async () => {
      const result = await service.recordActivity('u1', {
        type: ActivityType.FEED_READ,
        pagesDelta: 0,
      });
      expect(result.counted).toBe(true);
      const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
      expect(upsert.update.activityCount).toEqual({ increment: 1 });
      expect(upsert.create.activityCount).toBe(1);
    });

    it('returns counted:false when the type was already counted today', async () => {
      prisma.dailyActivityType.create.mockRejectedValueOnce(p2002());
      await expect(
        service.recordActivity('u1', { type: ActivityType.FEED_READ, pagesDelta: 0 }),
      ).resolves.toEqual({
        dayKey: expect.any(String),
        counted: false,
      });
      const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
      expect(upsert.update.activityCount).toBeUndefined();
    });

    it('inserts a receipt when an operationId is supplied', async () => {
      await service.recordActivity('u1', {
        type: ActivityType.BOOK_READ,
        pagesDelta: 1,
        operationId: 'op-1',
      });
      expect(prisma.activityEventReceipt.create).toHaveBeenCalledWith({
        data: { userId: 'u1', operationId: 'op-1' },
      });
    });

    it('does not insert a receipt when no operationId is supplied', async () => {
      await service.recordActivity('u1', { type: ActivityType.BOOK_READ, pagesDelta: 1 });
      expect(prisma.activityEventReceipt.create).not.toHaveBeenCalled();
    });

    it('treats a receipt P2002 as a replay and skips the pagesRead increment', async () => {
      prisma.activityEventReceipt.create.mockRejectedValueOnce(p2002());
      prisma.dailyActivityType.create.mockRejectedValueOnce(p2002());
      const result = await service.recordActivity('u1', {
        type: ActivityType.BOOK_READ,
        pagesDelta: 1,
        operationId: 'op-1',
      });
      expect(result.counted).toBe(false);
      const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
      expect(upsert.update.pagesRead.increment).toBe(0);
      expect(upsert.update.activityCount).toBeUndefined();
    });

    it('counts the day but adds no pages on an operationId replay [gate independence]', async () => {
      // Receipt gate fires (replay) while the type gate SUCCEEDS: the two gates
      // are independent, so the day still counts even though pages are skipped.
      prisma.activityEventReceipt.create.mockRejectedValueOnce(p2002());
      const result = await service.recordActivity('u1', {
        type: ActivityType.BOOK_READ,
        pagesDelta: 1,
        operationId: 'op-1',
      });
      expect(result.counted).toBe(true);
      const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
      expect(upsert.update.pagesRead.increment).toBe(0);
      expect(upsert.update.activityCount).toEqual({ increment: 1 });
      expect(upsert.create).toEqual(
        expect.objectContaining({ pagesRead: 0, activityCount: 1 }),
      );
    });

    it('adds pages but does not count a repeat type with a positive delta [gate independence]', async () => {
      // Type gate rejects (already counted) while there is no replay: pages must
      // still accumulate while activityCount stays flat.
      prisma.dailyActivityType.create.mockRejectedValueOnce(p2002());
      const result = await service.recordActivity('u1', {
        type: ActivityType.BOOK_READ,
        pagesDelta: 1,
      });
      expect(result.counted).toBe(false);
      expect(prisma.activityEventReceipt.create).not.toHaveBeenCalled();
      const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
      expect(upsert.update.pagesRead.increment).toBe(1);
      expect(upsert.update.activityCount).toBeUndefined();
    });

    it('rethrows a non-unique receipt error', async () => {
      prisma.activityEventReceipt.create.mockRejectedValueOnce(new Error('boom'));
      await expect(
        service.recordActivity('u1', {
          type: ActivityType.BOOK_READ,
          pagesDelta: 1,
          operationId: 'op-1',
        }),
      ).rejects.toThrow('boom');
    });

    it('rethrows a non-unique daily type error', async () => {
      prisma.dailyActivityType.create.mockRejectedValueOnce(new Error('boom'));
      await expect(
        service.recordActivity('u1', { type: ActivityType.FEED_READ, pagesDelta: 0 }),
      ).rejects.toThrow('boom');
    });

    it('refreshes the streak cache inside the same transaction client', async () => {
      const result = await service.recordActivity('u1', {
        type: ActivityType.FEED_READ,
        pagesDelta: 0,
      });
      expect(streaks.refreshCache).toHaveBeenCalledWith('u1', result.dayKey, prisma);
    });
  });

  // ── getMyProgress ──────────────────────────────────────────────────────────

  describe('getMyProgress', () => {
    it('scopes the year query with lexicographic dayKey bounds', async () => {
      await service.getMyProgress('u1', 2026);
      expect(prisma.dailyActivity.findMany.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          where: { userId: 'u1', dayKey: { gte: '2026-01-01', lt: '2027-01-01' } },
          orderBy: { dayKey: 'asc' },
        }),
      );
    });

    it('returns zeros and a null goal for a brand-new user', async () => {
      prisma.dailyActivity.findMany.mockResolvedValue([]);
      prisma.userStreak.findUnique.mockResolvedValue(null);
      prisma.readingGoal.findUnique.mockResolvedValue(null);
      await expect(service.getMyProgress('new', 2026)).resolves.toMatchObject({
        year: 2026,
        daysRead: 0,
        pagesRead: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDayKey: null,
        goal: null,
      });
    });

    it('always recomputes the current streak', async () => {
      streaks.computeCurrent.mockResolvedValue(4);
      const result = await service.getMyProgress('u1', 2026);
      expect(streaks.computeCurrent).toHaveBeenCalledWith(
        'u1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(result.currentStreak).toBe(4);
    });

    it('aggregates daysRead, pagesRead, and lastActiveDayKey from the year rows', async () => {
      prisma.dailyActivity.findMany.mockResolvedValueOnce([
        { dayKey: '2026-01-01', pagesRead: 2, activityCount: 1 },
        { dayKey: '2026-03-01', pagesRead: 3, activityCount: 2 },
      ]);
      const result = await service.getMyProgress('u1', 2026);
      expect(result.daysRead).toBe(2);
      expect(result.pagesRead).toBe(5);
      expect(result.lastActiveDayKey).toBe('2026-03-01');
    });

    it('maps the reading goal into the progress shape', async () => {
      prisma.readingGoal.findUnique.mockResolvedValue({
        year: 2026,
        targetKind: 'PAGES',
        targetValue: 12000,
      });
      const result = await service.getMyProgress('u1', 2026);
      expect(result.goal).toEqual({ year: 2026, targetKind: 'PAGES', targetValue: 12000 });
      expect(prisma.readingGoal.findUnique).toHaveBeenCalledWith({
        where: { userId_year: { userId: 'u1', year: 2026 } },
      });
    });

    it('serves longestStreak from the cache when it is fresh', async () => {
      prisma.dailyActivity.findMany
        .mockResolvedValueOnce([{ dayKey: '2026-10-06', pagesRead: 3, activityCount: 1 }])
        .mockResolvedValueOnce([{ dayKey: '2026-10-06' }]);
      prisma.userStreak.findUnique.mockResolvedValue({
        longestStreak: 9,
        lastActiveDayKey: '2026-10-06',
      });
      const result = await service.getMyProgress('u1', 2026);
      expect(result.longestStreak).toBe(9);
      expect(streaks.computeLongest).not.toHaveBeenCalled();
    });

    it('recomputes longestStreak when the cache is stale', async () => {
      prisma.dailyActivity.findMany
        .mockResolvedValueOnce([{ dayKey: '2026-10-06', pagesRead: 1, activityCount: 1 }])
        .mockResolvedValueOnce([{ dayKey: '2026-10-06' }]);
      prisma.userStreak.findUnique.mockResolvedValue({
        longestStreak: 3,
        lastActiveDayKey: '2026-10-01',
      });
      streaks.computeLongest.mockResolvedValue(11);
      const result = await service.getMyProgress('u1', 2026);
      expect(result.longestStreak).toBe(11);
      expect(streaks.computeLongest).toHaveBeenCalledWith('u1');
    });

    it('recomputes longestStreak when the cache is absent', async () => {
      prisma.userStreak.findUnique.mockResolvedValue(null);
      streaks.computeLongest.mockResolvedValue(4);
      const result = await service.getMyProgress('u1', 2026);
      expect(result.longestStreak).toBe(4);
      expect(streaks.computeLongest).toHaveBeenCalledWith('u1');
    });
  });

  // ── getActivityCalendar ────────────────────────────────────────────────────

  describe('getActivityCalendar', () => {
    it('returns the year rows as calendar points', async () => {
      prisma.dailyActivity.findMany.mockResolvedValue([
        { dayKey: '2026-01-01', activityCount: 2, pagesRead: 3 },
      ]);
      const points = await service.getActivityCalendar('u1', 2026);
      expect(points).toEqual([{ dayKey: '2026-01-01', activityCount: 2, pagesRead: 3 }]);
      expect(prisma.dailyActivity.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', dayKey: { gte: '2026-01-01', lt: '2027-01-01' } },
        orderBy: { dayKey: 'asc' },
        select: { dayKey: true, activityCount: true, pagesRead: true },
      });
    });

    it('returns an empty array when there is no activity', async () => {
      prisma.dailyActivity.findMany.mockResolvedValue([]);
      await expect(service.getActivityCalendar('u1', 2026)).resolves.toEqual([]);
    });
  });

  // ── setReadingGoal ─────────────────────────────────────────────────────────

  describe('setReadingGoal', () => {
    it('upserts the goal on (user, year) and returns it', async () => {
      const result = await service.setReadingGoal('u1', {
        year: 2026,
        targetKind: GoalKind.DAYS,
        targetValue: 24,
      });
      expect(prisma.readingGoal.upsert).toHaveBeenCalledWith({
        where: { userId_year: { userId: 'u1', year: 2026 } },
        create: {
          userId: 'u1',
          year: 2026,
          targetKind: GoalKind.DAYS,
          targetValue: 24,
        },
        update: { targetKind: GoalKind.DAYS, targetValue: 24 },
      });
      expect(result).toEqual({ year: 2026, targetKind: 'DAYS', targetValue: 24 });
    });
  });
});
