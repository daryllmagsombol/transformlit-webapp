import { Field, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ActivityType, GoalKind } from '@transformlit/shared';

registerEnumType(ActivityType, { name: 'ActivityType' });
registerEnumType(GoalKind, { name: 'GoalKind' });

@ObjectType()
export class ReadingGoal {
  @Field(() => Int)
  year: number;

  @Field(() => GoalKind)
  targetKind: GoalKind;

  @Field(() => Int)
  targetValue: number;
}

@ObjectType()
export class MyProgress {
  @Field(() => Int)
  year: number;

  @Field(() => ReadingGoal, { nullable: true })
  goal: ReadingGoal | null;

  @Field(() => Int)
  daysRead: number;

  @Field(() => Int)
  pagesRead: number;

  @Field(() => Int)
  currentStreak: number;

  @Field(() => Int)
  longestStreak: number;

  @Field(() => String, { nullable: true })
  lastActiveDayKey: string | null;
}

@ObjectType()
export class DailyActivityPoint {
  @Field()
  dayKey: string;

  @Field(() => Int)
  activityCount: number;

  @Field(() => Int)
  pagesRead: number;
}

@InputType()
export class RecordActivityInput {
  @Field(() => ActivityType)
  type: ActivityType;

  @Field(() => Int, { defaultValue: 0 })
  pagesDelta: number;

  @Field(() => String, { nullable: true })
  operationId?: string;
}

@ObjectType()
export class RecordActivityPayload {
  @Field()
  dayKey: string;

  @Field()
  counted: boolean;
}

@InputType()
export class SetReadingGoalInput {
  @Field(() => Int)
  year: number;

  @Field(() => GoalKind)
  targetKind: GoalKind;

  @Field(() => Int)
  targetValue: number;
}
