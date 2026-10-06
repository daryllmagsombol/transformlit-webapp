/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SharedHighlightsService } from './shared-highlights.service';

const activeMember = { status: 'ACTIVE', role: 'MEMBER' };

const ownedHighlight = {
  id: 'hl-1',
  userId: 'user-1',
  bookId: 'book-1',
  page: 12,
  text: 'A quote',
  note: null,
  color: 'yellow',
  deletedAt: null,
};

const mockShare = {
  id: 'share-1',
  groupId: 'group-1',
  highlightId: 'hl-1',
  sharedById: 'user-1',
  createdAt: new Date('2024-01-01'),
  deletedAt: null,
};

/** Mirrors the service's GROUP_HIGHLIGHT_INCLUDE so write/read args are asserted. */
const EXPECTED_INCLUDE = {
  highlight: { include: { book: { select: { title: true } } } },
  sharedBy: { select: { id: true, displayName: true, avatarUrl: true } },
};

describe('SharedHighlightsService', () => {
  let service: SharedHighlightsService;
  let prisma: any;
  let groups: any;

  beforeEach(() => {
    prisma = {
      highlight: {
        findUnique: jest.fn().mockResolvedValue(ownedHighlight),
      },
      groupHighlight: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([mockShare]),
        create: jest.fn().mockResolvedValue(mockShare),
        update: jest.fn().mockResolvedValue(mockShare),
      },
    };
    groups = {
      getMembershipFor: jest.fn().mockResolvedValue(activeMember),
      assertCanModerate: jest.fn().mockResolvedValue(activeMember),
    };

    service = new SharedHighlightsService(prisma as any, groups as any);
    jest.clearAllMocks();

    prisma.highlight.findUnique.mockResolvedValue(ownedHighlight);
    prisma.groupHighlight.findUnique.mockResolvedValue(null);
    prisma.groupHighlight.findMany.mockResolvedValue([mockShare]);
    prisma.groupHighlight.create.mockResolvedValue(mockShare);
    prisma.groupHighlight.update.mockResolvedValue(mockShare);
    groups.getMembershipFor.mockResolvedValue(activeMember);
    groups.assertCanModerate.mockResolvedValue(activeMember);
  });

  // ── share ───────────────────────────────────────────────────────────────────

  describe('share', () => {
    it('should reject a non-member with ForbiddenException', async () => {
      groups.getMembershipFor.mockResolvedValue(null);
      await expect(
        service.share('user-1', { groupId: 'group-1', highlightId: 'hl-1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.groupHighlight.create).not.toHaveBeenCalled();
    });

    it('should reject a non-ACTIVE member with ForbiddenException', async () => {
      groups.getMembershipFor.mockResolvedValue({ status: 'PENDING', role: 'MEMBER' });
      await expect(
        service.share('user-1', { groupId: 'group-1', highlightId: 'hl-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject a missing highlight with NotFoundException', async () => {
      prisma.highlight.findUnique.mockResolvedValue(null);
      await expect(
        service.share('user-1', { groupId: 'group-1', highlightId: 'hl-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.groupHighlight.create).not.toHaveBeenCalled();
    });

    it('should reject a soft-deleted highlight with NotFoundException', async () => {
      prisma.highlight.findUnique.mockResolvedValue({
        ...ownedHighlight,
        deletedAt: new Date(),
      });
      await expect(
        service.share('user-1', { groupId: 'group-1', highlightId: 'hl-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject sharing a highlight owned by another user', async () => {
      prisma.highlight.findUnique.mockResolvedValue({
        ...ownedHighlight,
        userId: 'someone-else',
      });
      await expect(
        service.share('user-1', { groupId: 'group-1', highlightId: 'hl-1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.groupHighlight.create).not.toHaveBeenCalled();
    });

    it('should create a share when none exists', async () => {
      const result = await service.share('user-1', {
        groupId: 'group-1',
        highlightId: 'hl-1',
      });
      expect(prisma.groupHighlight.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-1',
          highlightId: 'hl-1',
          sharedById: 'user-1',
        },
        include: EXPECTED_INCLUDE,
      });
      expect(result).toEqual(mockShare);
    });

    it('should be idempotent and return the existing non-deleted share', async () => {
      prisma.groupHighlight.findUnique.mockResolvedValue(mockShare);
      const result = await service.share('user-1', {
        groupId: 'group-1',
        highlightId: 'hl-1',
      });
      expect(result).toEqual(mockShare);
      expect(prisma.groupHighlight.create).not.toHaveBeenCalled();
      expect(prisma.groupHighlight.update).not.toHaveBeenCalled();
    });

    it('should revive a soft-deleted share instead of inserting a new row', async () => {
      prisma.groupHighlight.findUnique.mockResolvedValue({
        ...mockShare,
        deletedAt: new Date(),
      });
      const revived = { ...mockShare, deletedAt: null };
      prisma.groupHighlight.update.mockResolvedValue(revived);
      const result = await service.share('user-1', {
        groupId: 'group-1',
        highlightId: 'hl-1',
      });
      expect(prisma.groupHighlight.create).not.toHaveBeenCalled();
      expect(prisma.groupHighlight.update).toHaveBeenCalledWith({
        where: { id: 'share-1' },
        data: { deletedAt: null },
        include: EXPECTED_INCLUDE,
      });
      expect(result).toEqual(revived);
    });

    it('should look up the existing share by the (groupId, highlightId) unique key', async () => {
      await service.share('user-1', { groupId: 'group-1', highlightId: 'hl-1' });
      expect(prisma.groupHighlight.findUnique).toHaveBeenCalledWith({
        where: {
          groupId_highlightId: { groupId: 'group-1', highlightId: 'hl-1' },
        },
        include: EXPECTED_INCLUDE,
      });
    });
  });

  // ── unshare ─────────────────────────────────────────────────────────────────

  describe('unshare', () => {
    it('should throw NotFoundException when the share is missing', async () => {
      prisma.groupHighlight.findUnique.mockResolvedValue(null);
      await expect(service.unshare('user-1', 'share-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.groupHighlight.update).not.toHaveBeenCalled();
    });

    it('should allow the sharer without a moderator check', async () => {
      prisma.groupHighlight.findUnique.mockResolvedValue(mockShare);
      const result = await service.unshare('user-1', 'share-1');
      expect(result).toBe(true);
      expect(groups.assertCanModerate).not.toHaveBeenCalled();
      expect(prisma.groupHighlight.update).toHaveBeenCalledWith({
        where: { id: 'share-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should allow a moderator who is not the sharer', async () => {
      prisma.groupHighlight.findUnique.mockResolvedValue({
        ...mockShare,
        sharedById: 'someone-else',
      });
      const result = await service.unshare('mod-1', 'share-1');
      expect(result).toBe(true);
      expect(groups.assertCanModerate).toHaveBeenCalledWith('group-1', 'mod-1');
      expect(prisma.groupHighlight.update).toHaveBeenCalled();
    });

    it('should reject an unrelated member via assertCanModerate', async () => {
      prisma.groupHighlight.findUnique.mockResolvedValue({
        ...mockShare,
        sharedById: 'someone-else',
      });
      groups.assertCanModerate.mockRejectedValue(
        new ForbiddenException('You need to be an owner or moderator'),
      );
      await expect(service.unshare('user-1', 'share-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupHighlight.update).not.toHaveBeenCalled();
    });
  });

  // ── list ────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should reject a non-ACTIVE member', async () => {
      groups.getMembershipFor.mockResolvedValue(null);
      await expect(service.list('user-1', 'group-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupHighlight.findMany).not.toHaveBeenCalled();
    });

    it('should query non-deleted shares newest first with highlight/book/sharedBy', async () => {
      await service.list('user-1', 'group-1');
      expect(prisma.groupHighlight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'group-1', deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: {
            highlight: { include: { book: { select: { title: true } } } },
            sharedBy: {
              select: { id: true, displayName: true, avatarUrl: true },
            },
          },
        }),
      );
    });

    it('should apply default offset 0 and limit 25', async () => {
      await service.list('user-1', 'group-1');
      expect(prisma.groupHighlight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
    });

    it('should forward offset and limit for pagination', async () => {
      await service.list('user-1', 'group-1', 25, 10);
      expect(prisma.groupHighlight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 25, take: 10 }),
      );
    });

    it('should clamp out-of-range pagination values', async () => {
      await service.list('user-1', 'group-1', 999_999, 500);
      expect(prisma.groupHighlight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10_000, take: 50 }),
      );
    });

    it('should return the rows from Prisma', async () => {
      const result = await service.list('user-1', 'group-1');
      expect(result).toEqual([mockShare]);
    });
  });
});
