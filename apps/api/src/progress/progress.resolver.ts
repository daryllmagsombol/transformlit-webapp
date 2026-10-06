import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { GoalKind } from '@transformlit/shared';
import { ProgressService } from './progress.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  DailyActivityPoint,
  MyProgress,
  ReadingGoal,
  RecordActivityInput,
  RecordActivityPayload,
  SetReadingGoalInput,
} from './models/progress.model.js';

/** Stable code so clients can classify goal validation failures. */
export const BAD_USER_INPUT_CODE = 'BAD_USER_INPUT';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Inclusive `targetValue` bounds per goal kind, from the spec. */
const TARGET_VALUE_BOUNDS: Record<GoalKind, { min: number; max: number }> = {
  [GoalKind.DAYS]: { min: 1, max: 366 },
  [GoalKind.PAGES]: { min: 1, max: 100000 },
};

function assertValidYear(year: number): void {
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new GraphQLError(`year must be between ${MIN_YEAR} and ${MAX_YEAR}`, {
      extensions: { code: BAD_USER_INPUT_CODE, argument: 'year' },
    });
  }
}

function assertValidTargetValue(targetKind: GoalKind, targetValue: number): void {
  const bounds = TARGET_VALUE_BOUNDS[targetKind];
  if (targetValue < bounds.min || targetValue > bounds.max) {
    throw new GraphQLError(
      `targetValue for ${targetKind} must be between ${bounds.min} and ${bounds.max}`,
      { extensions: { code: BAD_USER_INPUT_CODE, argument: 'targetValue' } },
    );
  }
}

@Resolver()
export class ProgressResolver {
  constructor(private readonly progressService: ProgressService) {}

  @Query(() => MyProgress, { name: 'myProgress' })
  @UseGuards(JwtAuthGuard)
  async myProgress(
    @CurrentUser() user: { id: string },
    @Args('year', { type: () => Int }) year: number,
  ): Promise<MyProgress> {
    return this.progressService.getMyProgress(user.id, year);
  }

  @Query(() => [DailyActivityPoint], { name: 'myActivityCalendar' })
  @UseGuards(JwtAuthGuard)
  async myActivityCalendar(
    @CurrentUser() user: { id: string },
    @Args('year', { type: () => Int }) year: number,
  ): Promise<DailyActivityPoint[]> {
    return this.progressService.getActivityCalendar(user.id, year);
  }

  @Mutation(() => RecordActivityPayload, { name: 'recordActivity' })
  @UseGuards(JwtAuthGuard)
  async recordActivity(
    @CurrentUser() user: { id: string },
    @Args('input') input: RecordActivityInput,
  ): Promise<RecordActivityPayload> {
    return this.progressService.recordActivity(user.id, input);
  }

  @Mutation(() => ReadingGoal, { name: 'setReadingGoal' })
  @UseGuards(JwtAuthGuard)
  async setReadingGoal(
    @CurrentUser() user: { id: string },
    @Args('input') input: SetReadingGoalInput,
  ): Promise<ReadingGoal> {
    assertValidYear(input.year);
    assertValidTargetValue(input.targetKind, input.targetValue);
    return this.progressService.setReadingGoal(user.id, input);
  }
}
