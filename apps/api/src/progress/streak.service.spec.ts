import { currentStreakFromDays, longestStreakFromDays, StreakService } from './streak.service.js';

describe('currentStreakFromDays', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreakFromDays(['2026-10-04', '2026-10-05', '2026-10-06'], '2026-10-06')).toBe(3);
  });

  it('tolerates a not-yet-read today by walking back from yesterday', () => {
    expect(currentStreakFromDays(['2026-10-04', '2026-10-05'], '2026-10-06')).toBe(2);
  });

  it('returns 0 when the last activity is older than yesterday', () => {
    expect(currentStreakFromDays(['2026-10-01'], '2026-10-06')).toBe(0);
  });

  it('returns 0 for an empty ledger', () => {
    expect(currentStreakFromDays([], '2026-10-06')).toBe(0);
  });

  it('breaks on a gap', () => {
    expect(currentStreakFromDays(['2026-10-01', '2026-10-05', '2026-10-06'], '2026-10-06')).toBe(2);
  });
});

describe('longestStreakFromDays', () => {
  it('finds the longest historical run', () => {
    expect(longestStreakFromDays(['2026-01-01', '2026-01-02', '2026-01-03', '2026-03-01'])).toBe(3);
  });

  it('returns 0 for an empty ledger', () => {
    expect(longestStreakFromDays([])).toBe(0);
  });
});

describe('StreakService', () => {
  let prisma: {
    dailyActivity: { findMany: jest.Mock };
    userStreak: { upsert: jest.Mock };
  };
  let tx: {
    dailyActivity: { findMany: jest.Mock };
    userStreak: { upsert: jest.Mock };
  };
  let service: StreakService;

  beforeEach(() => {
    prisma = { dailyActivity: { findMany: jest.fn() }, userStreak: { upsert: jest.fn() } };
    tx = { dailyActivity: { findMany: jest.fn() }, userStreak: { upsert: jest.fn() } };
    service = new StreakService(prisma as never);
  });

  it('computeCurrent reads the ledger and walks back from today', async () => {
    prisma.dailyActivity.findMany.mockResolvedValue([{ dayKey: '2026-10-04' }, { dayKey: '2026-10-05' }, { dayKey: '2026-10-06' }]);
    expect(await service.computeCurrent('user-1', '2026-10-06')).toBe(3);
    expect(prisma.dailyActivity.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { dayKey: true },
      orderBy: { dayKey: 'asc' },
    });
  });

  it('computeLongest reads the ledger and reports the longest run', async () => {
    prisma.dailyActivity.findMany.mockResolvedValue([{ dayKey: '2026-01-01' }, { dayKey: '2026-01-02' }, { dayKey: '2026-03-01' }]);
    expect(await service.computeLongest('user-1')).toBe(2);
  });

  it('refreshCache upserts the recomputed streak and last active day', async () => {
    prisma.dailyActivity.findMany.mockResolvedValue([{ dayKey: '2026-01-01' }, { dayKey: '2026-01-02' }, { dayKey: '2026-03-01' }]);
    prisma.userStreak.upsert.mockResolvedValue({});
    await service.refreshCache('user-1', '2026-03-01');
    expect(prisma.userStreak.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', currentStreak: 1, longestStreak: 2, lastActiveDayKey: '2026-03-01' },
      update: { currentStreak: 1, longestStreak: 2, lastActiveDayKey: '2026-03-01' },
    });
  });

  it('refreshCache uses the transaction client when provided', async () => {
    tx.dailyActivity.findMany.mockResolvedValue([]);
    tx.userStreak.upsert.mockResolvedValue({});
    await service.refreshCache('user-1', '2026-10-06', tx as never);
    expect(tx.dailyActivity.findMany).toHaveBeenCalled();
    expect(tx.userStreak.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ lastActiveDayKey: null }),
      }),
    );
    expect(prisma.dailyActivity.findMany).not.toHaveBeenCalled();
    expect(prisma.userStreak.upsert).not.toHaveBeenCalled();
  });
});
