import {
  Args,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ReadingPlansService } from './reading-plans.service.js';
import { SharedHighlightsService } from './shared-highlights.service.js';
import {
  CreateGroupReadingPlanInput,
  GroupHighlight,
  GroupReadingPlan,
  PlanMemberProgress,
  ShareHighlightInput,
} from './models/group-feature.model.js';

/** Shape of a `GroupHighlight` row returned by `SharedHighlightsService.list`. */
interface SharedHighlightRow {
  id: string;
  groupId: string;
  createdAt: Date;
  sharedBy: { id: string; displayName: string; avatarUrl: string | null };
  highlight: {
    id: string;
    bookId: string;
    page: number;
    text: string;
    note: string | null;
    color: string | null;
    book: { title: string };
  };
}

@Resolver(() => GroupReadingPlan)
export class GroupFeaturesResolver {
  constructor(
    private readonly readingPlans: ReadingPlansService,
    private readonly sharedHighlights: SharedHighlightsService,
  ) {}

  // ── Field resolvers (derived plan pacing) ──────────────────────────────────

  /**
   * The service's `getActive` result already carries `expectedPercent`; the
   * `createGroupReadingPlan` result does not, so fall back to the derived value
   * rather than returning null for this non-nullable field.
   */
  @ResolveField(() => Int)
  async expectedPercent(
    @Parent() plan: GroupReadingPlan,
    @CurrentUser() user: { id: string },
  ) {
    if (typeof plan.expectedPercent === 'number') return plan.expectedPercent;
    const active = await this.readingPlans.getActive(user.id, plan.groupId);
    return active?.expectedPercent ?? 0;
  }

  /** Same fallback rationale as {@link expectedPercent}. */
  @ResolveField(() => [PlanMemberProgress])
  async members(
    @Parent() plan: GroupReadingPlan,
    @CurrentUser() user: { id: string },
  ) {
    if (Array.isArray(plan.members)) return plan.members;
    const active = await this.readingPlans.getActive(user.id, plan.groupId);
    return active?.members ?? [];
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  @Query(() => GroupReadingPlan, { name: 'groupReadingPlan', nullable: true })
  @UseGuards(JwtAuthGuard)
  async groupReadingPlan(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
  ) {
    return this.readingPlans.getActive(user.id, groupId);
  }

  @Query(() => [GroupHighlight], { name: 'groupHighlights' })
  @UseGuards(JwtAuthGuard)
  async groupHighlights(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Args('limit', { type: () => Int, defaultValue: 25 }) limit: number,
  ) {
    const rows = (await this.sharedHighlights.list(
      user.id,
      groupId,
      offset,
      limit,
    )) as SharedHighlightRow[];
    return rows.map((row) => this.toGroupHighlight(row));
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  @Mutation(() => GroupReadingPlan, { name: 'createGroupReadingPlan' })
  @UseGuards(JwtAuthGuard)
  async createGroupReadingPlan(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateGroupReadingPlanInput,
  ) {
    return this.readingPlans.create(user.id, input);
  }

  @Mutation(() => Boolean, { name: 'archiveGroupReadingPlan' })
  @UseGuards(JwtAuthGuard)
  async archiveGroupReadingPlan(
    @CurrentUser() user: { id: string },
    @Args('planId') planId: string,
  ) {
    return this.readingPlans.archive(user.id, planId);
  }

  @Mutation(() => GroupHighlight, { name: 'shareHighlightToGroup' })
  @UseGuards(JwtAuthGuard)
  async shareHighlightToGroup(
    @CurrentUser() user: { id: string },
    @Args('input') input: ShareHighlightInput,
  ) {
    const share = await this.sharedHighlights.share(user.id, input);
    // `share()` includes `highlight.book.title` + `sharedBy`; flatten it to the
    // GraphQL shape exactly like `groupHighlights` does, so the non-null nested
    // fields resolve on the mutation result too.
    return this.toGroupHighlight(share as unknown as SharedHighlightRow);
  }

  @Mutation(() => Boolean, { name: 'unshareHighlight' })
  @UseGuards(JwtAuthGuard)
  async unshareHighlight(
    @CurrentUser() user: { id: string },
    @Args('shareId') shareId: string,
  ) {
    return this.sharedHighlights.unshare(user.id, shareId);
  }

  /** Flatten a join row into the GraphQL `SharedHighlight` shape. */
  private toGroupHighlight(row: SharedHighlightRow): GroupHighlight {
    return {
      id: row.id,
      groupId: row.groupId,
      createdAt: row.createdAt,
      sharedBy: row.sharedBy as GroupHighlight['sharedBy'],
      highlight: {
        id: row.highlight.id,
        bookId: row.highlight.bookId,
        bookTitle: row.highlight.book.title,
        page: row.highlight.page,
        text: row.highlight.text,
        note: row.highlight.note,
        color: row.highlight.color,
      },
    };
  }
}
