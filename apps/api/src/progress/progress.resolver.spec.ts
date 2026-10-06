/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityType, GoalKind } from '@transformlit/shared';
import { ProgressResolver } from './progress.resolver';
import { ProgressService } from './progress.service';

const mockProgress = {
  year: 2026,
  goal: null,
  daysRead: 0,
  pagesRead: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastActiveDayKey: null,
};

const mockUser = { id: 'u1' };

describe('ProgressResolver', () => {
  let resolver: ProgressResolver;
  let progressService: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockProgressService = {
      recordActivity: jest.fn().mockResolvedValue({ dayKey: '2026-10-06', counted: true }),
      getMyProgress: jest.fn().mockResolvedValue(mockProgress),
      getActivityCalendar: jest.fn().mockResolvedValue([]),
      setReadingGoal: jest
        .fn()
        .mockResolvedValue({ year: 2026, targetKind: GoalKind.DAYS, targetValue: 24 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressResolver,
        { provide: ProgressService, useValue: mockProgressService },
      ],
    }).compile();

    resolver = module.get<ProgressResolver>(ProgressResolver);
    progressService = module.get(ProgressService) as unknown as Record<string, jest.Mock>;
    jest.clearAllMocks();
  });

  // ── myProgress query ───────────────────────────────────────────────────────

  describe('myProgress', () => {
    it('delegates to getMyProgress with the current user id and year', async () => {
      const result = await resolver.myProgress(mockUser, 2026);
      expect(progressService.getMyProgress).toHaveBeenCalledWith('u1', 2026);
      expect(result).toEqual(mockProgress);
    });
  });

  // ── myActivityCalendar query ───────────────────────────────────────────────

  describe('myActivityCalendar', () => {
    it('delegates to getActivityCalendar with the current user id and year', async () => {
      const result = await resolver.myActivityCalendar(mockUser, 2026);
      expect(progressService.getActivityCalendar).toHaveBeenCalledWith('u1', 2026);
      expect(result).toEqual([]);
    });
  });

  // ── recordActivity mutation ────────────────────────────────────────────────

  describe('recordActivity', () => {
    it('delegates recordActivity with the current user id', async () => {
      const result = await resolver.recordActivity(mockUser, {
        type: ActivityType.BOOK_READ,
        pagesDelta: 1,
      });
      expect(progressService.recordActivity).toHaveBeenCalledWith('u1', {
        type: ActivityType.BOOK_READ,
        pagesDelta: 1,
      });
      expect(result).toEqual({ dayKey: '2026-10-06', counted: true });
    });

    it('forwards operationId so replay dedup works', async () => {
      await resolver.recordActivity(mockUser, {
        type: ActivityType.BOOK_READ,
        pagesDelta: 0,
        operationId: 'op-1',
      });
      expect(progressService.recordActivity).toHaveBeenCalledWith('u1', {
        type: ActivityType.BOOK_READ,
        pagesDelta: 0,
        operationId: 'op-1',
      });
    });
  });

  // ── setReadingGoal mutation ────────────────────────────────────────────────

  describe('setReadingGoal', () => {
    it('validates and delegates with the current user id and input', async () => {
      const result = await resolver.setReadingGoal(mockUser, {
        year: 2026,
        targetKind: GoalKind.DAYS,
        targetValue: 24,
      });
      expect(progressService.setReadingGoal).toHaveBeenCalledWith('u1', {
        year: 2026,
        targetKind: GoalKind.DAYS,
        targetValue: 24,
      });
      expect(result).toEqual({ year: 2026, targetKind: GoalKind.DAYS, targetValue: 24 });
    });

    it('rejects an out-of-range targetValue with a typed GraphQL error', async () => {
      await expect(
        resolver.setReadingGoal(mockUser, {
          year: 2026,
          targetKind: GoalKind.DAYS,
          targetValue: 999,
        }),
      ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
      expect(progressService.setReadingGoal).not.toHaveBeenCalled();
    });

    it('rejects a year outside the supported range', async () => {
      await expect(
        resolver.setReadingGoal(mockUser, {
          year: 1999,
          targetKind: GoalKind.PAGES,
          targetValue: 1000,
        }),
      ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
      expect(progressService.setReadingGoal).not.toHaveBeenCalled();
    });
  });
});
