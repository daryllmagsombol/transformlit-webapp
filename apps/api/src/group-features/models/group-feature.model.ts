import {
  Field,
  ObjectType,
  InputType,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { ReadingPlanStatus } from '@transformlit/shared';
import { Book } from '../../books/models/book.model.js';
import { User } from '../../auth/models/auth.model.js';

registerEnumType(ReadingPlanStatus, { name: 'ReadingPlanStatus' });

@ObjectType()
export class PlanMemberProgress {
  @Field(() => User)
  user: User;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int, { nullable: true })
  totalPages: number | null;

  @Field(() => Int)
  percent: number;

  @Field()
  onPace: boolean;
}

/**
 * A group's reading plan plus derived pacing. `expectedPercent` and `members`
 * are populated by `ReadingPlansService.getActive` on the returned object and
 * read back by the default field resolver; they are not stored columns.
 */
@ObjectType()
export class GroupReadingPlan {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  groupId: string;

  @Field(() => Book)
  book: Book;

  @Field({ nullable: true })
  title?: string;

  @Field()
  startDate: Date;

  @Field()
  targetDate: Date;

  @Field(() => ReadingPlanStatus)
  status: ReadingPlanStatus;

  @Field(() => ID, { nullable: true })
  createdById?: string;

  @Field()
  createdAt: Date;

  /**
   * Derived by `ReadingPlansService.getActive` and exposed via `@ResolveField`
   * (mirrors `Book.toc`), so it is intentionally not an `@Field` here.
   */
  expectedPercent?: number;

  /** Derived member rows, exposed via `@ResolveField`. */
  members?: PlanMemberProgress[];
}

@ObjectType()
export class SharedHighlight {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  bookId: string;

  @Field()
  bookTitle: string;

  @Field(() => Int)
  page: number;

  @Field()
  text: string;

  @Field({ nullable: true })
  note?: string;

  @Field({ nullable: true })
  color?: string;
}

@ObjectType()
export class GroupHighlight {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  groupId: string;

  @Field(() => SharedHighlight)
  highlight: SharedHighlight;

  @Field(() => User)
  sharedBy: User;

  @Field()
  createdAt: Date;
}

@InputType()
export class CreateGroupReadingPlanInput {
  @Field(() => ID)
  groupId: string;

  @Field(() => ID)
  bookId: string;

  @Field({ nullable: true })
  title?: string;

  @Field()
  startDate: Date;

  @Field()
  targetDate: Date;
}

@InputType()
export class ShareHighlightInput {
  @Field(() => ID)
  groupId: string;

  @Field(() => ID)
  highlightId: string;
}
