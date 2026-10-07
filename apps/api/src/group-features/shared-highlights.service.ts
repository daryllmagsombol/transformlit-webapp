import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GroupsService } from '../groups/groups.service.js';

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface ShareHighlightInput {
  groupId: string;
  highlightId: string;
}

/** Cap pagination so a client cannot force a deep table scan via a giant offset. */
const MAX_PAGE_OFFSET = 10_000;
const MAX_PAGE_LIMIT = 50;

/**
 * Shape returned by every read/write so the GraphQL `GroupHighlight` type's
 * non-null `highlight`/`sharedBy` fields always have a backing value.
 */
const GROUP_HIGHLIGHT_INCLUDE = {
  highlight: { include: { book: { select: { title: true } } } },
  sharedBy: { select: { id: true, displayName: true, avatarUrl: true } },
} as const;

/**
 * Group-scoped sharing of a reader's own highlights. Reads the shared
 * `Highlight`/`Book` tables via Prisma; only membership/role checks are
 * delegated to `GroupsService`.
 */
@Injectable()
export class SharedHighlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
  ) {}

  /** Share one owned highlight into a group, reviving a soft-deleted share. */
  async share(userId: string, input: ShareHighlightInput) {
    await this.assertActiveMember(input.groupId, userId);

    const highlight = await this.prisma.highlight.findUnique({
      where: { id: input.highlightId },
    });
    if (!highlight || highlight.deletedAt !== null) {
      throw new NotFoundException('Highlight not found');
    }
    if (highlight.userId !== userId) {
      throw new ForbiddenException('You can only share your own highlights');
    }

    const existing = await this.prisma.groupHighlight.findUnique({
      where: {
        groupId_highlightId: {
          groupId: input.groupId,
          highlightId: input.highlightId,
        },
      },
      include: GROUP_HIGHLIGHT_INCLUDE,
    });
    if (existing?.deletedAt === null) {
      return existing;
    }
    if (existing) {
      return this.prisma.groupHighlight.update({
        where: { id: existing.id },
        data: { deletedAt: null },
        include: GROUP_HIGHLIGHT_INCLUDE,
      });
    }
    try {
      return await this.prisma.groupHighlight.create({
        data: {
          groupId: input.groupId,
          highlightId: input.highlightId,
          sharedById: userId,
        },
        include: GROUP_HIGHLIGHT_INCLUDE,
      });
    } catch (error) {
      // A concurrent share of the same (groupId, highlightId) can win the
      // unique constraint between our findUnique and create; re-read the
      // winner so the operation stays idempotent instead of returning a 500.
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.groupHighlight.findUnique({
        where: {
          groupId_highlightId: {
            groupId: input.groupId,
            highlightId: input.highlightId,
          },
        },
        include: GROUP_HIGHLIGHT_INCLUDE,
      });
      if (winner) return winner;
      throw error;
    }
  }

  /** Soft-delete a share. Allowed for the sharer or a group owner/moderator. */
  async unshare(userId: string, shareId: string): Promise<boolean> {
    const share = await this.prisma.groupHighlight.findUnique({
      where: { id: shareId },
    });
    if (!share) {
      throw new NotFoundException('Shared highlight not found');
    }
    if (share.sharedById !== userId) {
      await this.groups.assertCanModerate(share.groupId, userId);
    }
    await this.prisma.groupHighlight.update({
      where: { id: shareId },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  /** Non-deleted shares for a group, newest first, paginated. */
  async list(userId: string, groupId: string, offset = 0, limit = 25) {
    await this.assertActiveMember(groupId, userId);
    const safeOffset = Math.max(0, Math.min(offset, MAX_PAGE_OFFSET));
    const safeTake = Math.min(Math.max(limit, 1), MAX_PAGE_LIMIT);
    return this.prisma.groupHighlight.findMany({
      // A share whose source highlight was later deleted must not be served:
      // `share()` already rejects a deleted highlight, so the feed must match.
      where: { groupId, deletedAt: null, highlight: { deletedAt: null } },
      include: GROUP_HIGHLIGHT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: safeOffset,
      take: safeTake,
    });
  }

  private async assertActiveMember(groupId: string, userId: string) {
    const membership = await this.groups.getMembershipFor(groupId, userId);
    if (membership?.status !== 'ACTIVE') {
      throw new ForbiddenException('Only active members can do this');
    }
  }
}
