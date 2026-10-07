import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GroupsService } from '../groups/groups.service.js';
import { expectedPercent, isOnPace, memberPercent } from './progress.js';

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Input accepted by {@link ReadingPlansService.create}. */
export interface CreateReadingPlanInput {
  groupId: string;
  bookId: string;
  title?: string | null;
  startDate: Date;
  targetDate: Date;
}

/** A single member's derived progress toward the active plan's book. */
export interface PlanMemberProgress {
  user: { id: string; displayName: string; avatarUrl: string | null };
  currentPage: number;
  totalPages: number | null;
  percent: number;
  onPace: boolean;
}

/**
 * Group reading plans. Plans store only the book plus a start/target window;
 * member progress is derived at read time from the shared `BookProgress` rows,
 * so there is no denormalized state to keep in sync.
 */
@Injectable()
export class ReadingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
  ) {}

  /**
   * Create a new ACTIVE plan for a group, archiving any plan already ACTIVE.
   * Requires an ACTIVE owner/moderator.
   */
  async create(userId: string, input: CreateReadingPlanInput) {
    await this.groups.assertCanModerate(input.groupId, userId);
    if (input.targetDate.getTime() <= input.startDate.getTime()) {
      throw new BadRequestException('targetDate must be after startDate');
    }
    const book = await this.prisma.book.findUnique({
      where: { id: input.bookId },
      select: { id: true, deletedAt: true },
    });
    if (!book || book.deletedAt !== null) {
      throw new NotFoundException('Book not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.groupReadingPlan.updateMany({
        where: { groupId: input.groupId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
      const plan = await tx.groupReadingPlan.create({
        data: {
          groupId: input.groupId,
          bookId: input.bookId,
          title: input.title ?? null,
          startDate: input.startDate,
          targetDate: input.targetDate,
          status: 'ACTIVE',
          createdById: userId,
        },
        include: { book: true },
      });
      // Attach the derived fields a brand-new plan has, so the GraphQL field
      // resolvers do not fall back to a second `getActive` read (3 more queries)
      // just to render the mutation result. Members start with no rows.
      return {
        ...plan,
        expectedPercent: expectedPercent(plan.startDate, plan.targetDate, new Date()),
        members: [] as PlanMemberProgress[],
      };
    }).catch((error: unknown) => {
      // A partial unique index (one ACTIVE plan per group) can lose a race to a
      // concurrent create; surface a clear conflict instead of a raw P2002.
      if (isUniqueViolation(error)) {
        throw new ConflictException('Another plan was just created for this group');
      }
      throw error;
    });
  }

  /**
   * Archive a plan. Requires an ACTIVE owner/moderator of the plan's group.
   * Returns `true` when the plan existed and was archived.
   */
  async archive(userId: string, planId: string): Promise<boolean> {
    const plan = await this.prisma.groupReadingPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Reading plan not found');
    await this.groups.assertCanModerate(plan.groupId, userId);
    await this.prisma.groupReadingPlan.update({
      where: { id: planId },
      data: { status: 'ARCHIVED' },
    });
    return true;
  }

  /**
   * The group's ACTIVE plan with derived pacing, or `null` when none exists.
   * Requires ACTIVE membership. Member rows are built from every ACTIVE member
   * plus their `BookProgress` for the plan's book (0 progress when absent),
   * using two bulk queries rather than per-member lookups.
   */
  async getActive(userId: string, groupId: string) {
    const membership = await this.groups.getMembershipFor(groupId, userId);
    if (membership?.status !== 'ACTIVE') {
      throw new ForbiddenException('Only active members can do this');
    }

    const plan = await this.prisma.groupReadingPlan.findFirst({
      where: { groupId, status: 'ACTIVE' },
      include: { book: true },
    });
    if (!plan) return null;

    const expected = expectedPercent(plan.startDate, plan.targetDate, new Date());
    const members = await this.prisma.groupMember.findMany({
      where: { groupId, status: 'ACTIVE' },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    // Scope progress to this group's members only — a popular book may have
    // thousands of unrelated readers, and only member rows are rendered.
    const memberIds = members.map((member) => member.userId);
    const progressRows = memberIds.length
      ? await this.prisma.bookProgress.findMany({
          where: { bookId: plan.bookId, userId: { in: memberIds } },
        })
      : [];

    const progressByUser = new Map(
      progressRows.map((row) => [row.userId, row.currentPage]),
    );
    const totalPages = plan.book?.totalPages ?? null;
    const membersWithProgress = members.map((member) =>
      this.buildMemberRow(member, totalPages, progressByUser, expected),
    );

    return { ...plan, expectedPercent: expected, members: membersWithProgress };
  }

  /** Derive one member's current page/percent/on-pace from the bulk maps. */
  private buildMemberRow(
    member: {
      userId: string;
      user: { id: string; displayName: string; avatarUrl: string | null };
    },
    totalPages: number | null,
    progressByUser: Map<string, number>,
    expected: number,
  ): PlanMemberProgress {
    const currentPage = progressByUser.get(member.userId) ?? 0;
    const percent = memberPercent(currentPage, totalPages);
    return {
      user: member.user,
      currentPage,
      totalPages,
      percent,
      onPace: isOnPace(percent, expected),
    };
  }
}
