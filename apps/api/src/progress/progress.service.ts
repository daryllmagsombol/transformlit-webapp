import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ActivityType, GoalKind } from '@transformlit/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { toDayKey, yearBounds } from './day-key.util.js';
import { StreakService } from './streak.service.js';

/** Plain struct accepted by {@link ProgressService.recordActivity}. */
export interface RecordActivityStruct {
  type: ActivityType;
  pagesDelta: number;
  operationId?: string;
}

/** Plain struct accepted by {@link ProgressService.setReadingGoal}. */
export interface SetReadingGoalStruct {
  year: number;
  targetKind: GoalKind;
  targetValue: number;
}

export interface ReadingGoalShape {
  year: number;
  targetKind: GoalKind;
  targetValue: number;
}

export interface DailyActivityPointShape {
  dayKey: string;
  activityCount: number;
  pagesRead: number;
}

export interface MyProgressShape {
  year: number;
  goal: ReadingGoalShape | null;
  daysRead: number;
  pagesRead: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveDayKey: string | null;
}

/** Duck-typed unique-constraint check: accepts real Prisma errors and mocks. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Normalizes a client-supplied page delta to a stored `Int` in `[0, 1]`. */
function clampPagesDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Math.trunc(value)));
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly streaks: StreakService,
  ) {}

  /**
   * Records one activity event and updates the per-day rollup race-free.
   * The whole write (event, receipt, dedup gate, rollup, streak cache) runs in
   * a single transaction; `StreakService.refreshCache` receives that same `tx`
   * because Prisma does not support nested transactions.
   */
  async recordActivity(
    userId: string,
    input: RecordActivityStruct,
  ): Promise<{ dayKey: string; counted: boolean }> {
    const dayKey = toDayKey(new Date());
    const pagesDelta = clampPagesDelta(input.pagesDelta);

    return this.prisma.$transaction(async (tx) => {
      await tx.activityEvent.create({
        data: { userId, type: input.type, dayKey, pagesDelta },
      });

      const replayed = await this.claimReceipt(userId, input.operationId, tx);
      const counted = await this.claimActivityType(userId, dayKey, input.type, tx);

      await this.applyDailyRollup(tx, userId, dayKey, {
        pagesDelta: replayed ? 0 : pagesDelta,
        incrementActivityCount: counted,
      });
      await this.streaks.refreshCache(userId, dayKey, tx);

      return { dayKey, counted };
    });
  }

  /**
   * Secret-free idempotency: inserting the `(userId, operationId)` receipt is
   * the replay gate. A unique violation means the operation already applied, so
   * its `pagesDelta` must not be added again.
   */
  private async claimReceipt(
    userId: string,
    operationId: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (!operationId) return false;
    try {
      await tx.activityEventReceipt.create({ data: { userId, operationId } });
      return false;
    } catch (error) {
      if (isUniqueViolation(error)) return true;
      throw error;
    }
  }

  /**
   * Race-free daily dedup: a successful `(userId, dayKey, type)` insert means
   * this type counts today; a unique violation means it was already counted.
   */
  private async claimActivityType(
    userId: string,
    dayKey: string,
    type: ActivityType,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    try {
      await tx.dailyActivityType.create({ data: { userId, dayKey, type } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  private async applyDailyRollup(
    tx: Prisma.TransactionClient,
    userId: string,
    dayKey: string,
    rollup: { pagesDelta: number; incrementActivityCount: boolean },
  ): Promise<void> {
    const update: Prisma.DailyActivityUpdateInput = {
      pagesRead: { increment: rollup.pagesDelta },
    };
    if (rollup.incrementActivityCount) {
      update.activityCount = { increment: 1 };
    }
    await tx.dailyActivity.upsert({
      where: { userId_dayKey: { userId, dayKey } },
      create: {
        userId,
        dayKey,
        pagesRead: rollup.pagesDelta,
        activityCount: rollup.incrementActivityCount ? 1 : 0,
      },
      update,
    });
  }

  async getMyProgress(userId: string, year: number): Promise<MyProgressShape> {
    const rows = await this.readYearRows(userId, year);
    const goal = await this.readGoal(userId, year);
    const todayDayKey = toDayKey(new Date());
    const currentStreak = await this.streaks.computeCurrent(userId, todayDayKey);
    const longestStreak = await this.resolveLongestStreak(userId);

    return {
      year,
      goal,
      daysRead: rows.length,
      pagesRead: rows.reduce((total, row) => total + row.pagesRead, 0),
      currentStreak,
      longestStreak,
      lastActiveDayKey: rows.at(-1)?.dayKey ?? null,
    };
  }

  async getActivityCalendar(
    userId: string,
    year: number,
  ): Promise<DailyActivityPointShape[]> {
    const { startDayKey, endDayKey } = yearBounds(year);
    return this.prisma.dailyActivity.findMany({
      where: { userId, dayKey: { gte: startDayKey, lt: endDayKey } },
      orderBy: { dayKey: 'asc' },
      select: { dayKey: true, activityCount: true, pagesRead: true },
    });
  }

  async setReadingGoal(
    userId: string,
    input: SetReadingGoalStruct,
  ): Promise<ReadingGoalShape> {
    const goal = await this.prisma.readingGoal.upsert({
      where: { userId_year: { userId, year: input.year } },
      create: {
        userId,
        year: input.year,
        targetKind: input.targetKind,
        targetValue: input.targetValue,
      },
      update: { targetKind: input.targetKind, targetValue: input.targetValue },
    });
    return {
      year: goal.year,
      // Prisma's generated enum is structurally identical to the shared enum.
      targetKind: goal.targetKind as GoalKind,
      targetValue: goal.targetValue,
    };
  }

  private async readYearRows(userId: string, year: number) {
    const { startDayKey, endDayKey } = yearBounds(year);
    return this.prisma.dailyActivity.findMany({
      where: { userId, dayKey: { gte: startDayKey, lt: endDayKey } },
      orderBy: { dayKey: 'asc' },
    });
  }

  private async readGoal(userId: string, year: number): Promise<ReadingGoalShape | null> {
    const goal = await this.prisma.readingGoal.findUnique({
      where: { userId_year: { userId, year } },
    });
    if (!goal) return null;
    return {
      year: goal.year,
      // Prisma's generated enum is structurally identical to the shared enum.
      targetKind: goal.targetKind as GoalKind,
      targetValue: goal.targetValue,
    };
  }

  /**
   * `longestStreak` is cache-guarded: serve `UserStreak` only while its
   * `lastActiveDayKey` still equals the user's most recent activity day;
   * otherwise recompute (new activity, or no cache at all).
   */
  private async resolveLongestStreak(userId: string): Promise<number> {
    const cached = await this.prisma.userStreak.findUnique({ where: { userId } });
    if (cached) {
      const latestDayKey = await this.readLatestDayKey(userId);
      if (cached.lastActiveDayKey === latestDayKey) return cached.longestStreak;
    }
    return this.streaks.computeLongest(userId);
  }

  private async readLatestDayKey(userId: string): Promise<string | null> {
    const rows = await this.prisma.dailyActivity.findMany({
      where: { userId },
      orderBy: { dayKey: 'desc' },
      take: 1,
      select: { dayKey: true },
    });
    return rows[0]?.dayKey ?? null;
  }
}
