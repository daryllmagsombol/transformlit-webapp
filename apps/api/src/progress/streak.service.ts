import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shifts a `YYYY-MM-DD` calendar day by a whole number of days. */
function shiftDayKey(dayKey: string, deltaDays: number): string {
  const time = Date.parse(`${dayKey}T00:00:00.000Z`);
  return new Date(time + deltaDays * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Consecutive-day run ending at `todayDayKey`. Today is tolerated as
 * "not yet read": when today is absent the walk starts at yesterday. A last
 * activity older than yesterday yields 0. `days` is a sorted unique dayKey list.
 */
export function currentStreakFromDays(days: string[], todayDayKey: string): number {
  const present = new Set(days);
  let cursor = present.has(todayDayKey) ? todayDayKey : shiftDayKey(todayDayKey, -1);
  let streak = 0;
  while (present.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

/** Longest run of consecutive calendar days in a sorted unique dayKey list. */
export function longestStreakFromDays(days: string[]): number {
  if (days.length === 0) return 0;

  const sorted = [...new Set(days)].sort();
  let longest = 1;
  let run = 1;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === shiftDayKey(sorted[index - 1], 1)) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
  }
  return longest;
}

@Injectable()
export class StreakService {
  constructor(private readonly prisma: PrismaService) {}

  async computeCurrent(userId: string, todayDayKey: string): Promise<number> {
    const days = await this.readDayKeys(userId);
    return currentStreakFromDays(days, todayDayKey);
  }

  async computeLongest(userId: string): Promise<number> {
    const days = await this.readDayKeys(userId);
    return longestStreakFromDays(days);
  }

  /**
   * Recomputes and caches the user's streak. Pass an active transaction client
   * `tx` when the caller already holds one (Task 5): all reads and the upsert
   * then run on the same connection/snapshot, and Prisma never nests
   * `$transaction`.
   */
  async refreshCache(userId: string, todayDayKey: string, tx?: Prisma.TransactionClient): Promise<void> {
    const days = await this.readDayKeys(userId, tx);
    const currentStreak = currentStreakFromDays(days, todayDayKey);
    const longestStreak = longestStreakFromDays(days);
    const lastActiveDayKey = days.at(-1) ?? null;

    await (tx ?? this.prisma).userStreak.upsert({
      where: { userId },
      create: { userId, currentStreak, longestStreak, lastActiveDayKey },
      update: { currentStreak, longestStreak, lastActiveDayKey },
    });
  }

  private async readDayKeys(userId: string, tx?: Prisma.TransactionClient): Promise<string[]> {
    const rows = await (tx ?? this.prisma).dailyActivity.findMany({
      where: { userId },
      select: { dayKey: true },
      orderBy: { dayKey: 'asc' },
    });
    return rows.map((row) => row.dayKey);
  }
}
