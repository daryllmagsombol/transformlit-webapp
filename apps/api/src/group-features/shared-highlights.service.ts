import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GroupsService } from '../groups/groups.service.js';

export interface ShareHighlightInput {
  groupId: string;
  highlightId: string;
}

/** Cap pagination so a client cannot force a deep table scan via a giant offset. */
const MAX_PAGE_OFFSET = 10_000;
const MAX_PAGE_LIMIT = 50;

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
    });
    if (existing?.deletedAt === null) {
      return existing;
    }
    if (existing) {
      return this.prisma.groupHighlight.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      });
    }
    return this.prisma.groupHighlight.create({
      data: {
        groupId: input.groupId,
        highlightId: input.highlightId,
        sharedById: userId,
      },
    });
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
      where: { groupId, deletedAt: null },
      include: {
        highlight: { include: { book: { select: { title: true } } } },
        sharedBy: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
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
