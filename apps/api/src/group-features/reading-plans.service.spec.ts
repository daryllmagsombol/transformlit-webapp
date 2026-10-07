/// <reference types="jest" />
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReadingPlansService } from './reading-plans.service';

const planBook = { id: 'book-1', title: 'Dune', totalPages: 100 };

const mockPlan = {
  id: 'plan-1',
  groupId: 'group-1',
  bookId: 'book-1',
  title: 'January read',
  startDate: new Date('2000-01-01'),
  targetDate: new Date('2000-01-31'),
  status: 'ACTIVE',
  createdById: 'user-1',
  createdAt: new Date('2026-01-01'),
  book: planBook,
};

const activeMember = { status: 'ACTIVE', role: 'MEMBER' };

const memberA = {
  userId: 'user-1',
  user: { id: 'user-1', displayName: 'Alice', avatarUrl: null },
};
const memberB = {
  userId: 'user-2',
  user: { id: 'user-2', displayName: 'Bob', avatarUrl: null },
};

describe('ReadingPlansService', () => {
  let service: ReadingPlansService;
  let prisma: any;
  let groups: any;

  beforeEach(() => {
    prisma = {
      groupReadingPlan: {
        findUnique: jest.fn().mockResolvedValue(mockPlan),
        findFirst: jest.fn().mockResolvedValue(mockPlan),
        create: jest.fn().mockResolvedValue(mockPlan),
        update: jest.fn().mockResolvedValue(mockPlan),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      groupMember: {
        findMany: jest.fn().mockResolvedValue([memberA, memberB]),
      },
      bookProgress: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'user-1', currentPage: 95 }]),
      },
      $transaction: jest.fn(),
    };

    groups = {
      assertCanModerate: jest.fn().mockResolvedValue(activeMember),
      getMembershipFor: jest.fn().mockResolvedValue(activeMember),
    };

    service = new ReadingPlansService(prisma as any, groups as any);
    jest.clearAllMocks();

    prisma.groupReadingPlan.findUnique.mockResolvedValue(mockPlan);
    prisma.groupReadingPlan.findFirst.mockResolvedValue(mockPlan);
    prisma.groupReadingPlan.create.mockResolvedValue(mockPlan);
    prisma.groupReadingPlan.update.mockResolvedValue(mockPlan);
    prisma.groupReadingPlan.updateMany.mockResolvedValue({ count: 1 });
    prisma.groupMember.findMany.mockResolvedValue([memberA, memberB]);
    prisma.bookProgress.findMany.mockResolvedValue([{ userId: 'user-1', currentPage: 95 }]);
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    groups.assertCanModerate.mockResolvedValue(activeMember);
    groups.getMembershipFor.mockResolvedValue(activeMember);
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const input = {
      groupId: 'group-1',
      bookId: 'book-1',
      title: 'January read',
      startDate: new Date('2026-01-10'),
      targetDate: new Date('2026-01-20'),
    };

    it('should require an owner/moderator before creating', async () => {
      groups.assertCanModerate.mockRejectedValue(new ForbiddenException());
      await expect(service.create('user-1', input)).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject a targetDate at or before startDate', async () => {
      await expect(
        service.create('user-1', { ...input, targetDate: input.startDate }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should archive the prior ACTIVE plan before creating the new one', async () => {
      await service.create('user-1', input);
      expect(prisma.groupReadingPlan.updateMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
      expect(
        prisma.groupReadingPlan.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.groupReadingPlan.create.mock.invocationCallOrder[0]);
    });

    it('should create an ACTIVE plan owned by the creator', async () => {
      await service.create('user-1', input);
      expect(prisma.groupReadingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            groupId: 'group-1',
            bookId: 'book-1',
            title: 'January read',
            status: 'ACTIVE',
            createdById: 'user-1',
          }),
        }),
      );
    });

    it('should default a missing title to null', async () => {
      await service.create('user-1', { ...input, title: undefined });
      expect(prisma.groupReadingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: null }),
        }),
      );
    });

    it('should return the created plan with derived pacing fields attached', async () => {
      const result = await service.create('user-1', input);
      // The derived fields are attached so the GraphQL field resolvers do not
      // need a second `getActive` read for the mutation result.
      expect(result).toEqual({
        ...mockPlan,
        expectedPercent: expect.any(Number),
        members: [],
      });
    });
  });

  // ── archive ─────────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('should throw NotFoundException when the plan is missing', async () => {
      prisma.groupReadingPlan.findUnique.mockResolvedValue(null);
      await expect(service.archive('user-1', 'plan-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.groupReadingPlan.update).not.toHaveBeenCalled();
    });

    it('should authorize against the plan group and set ARCHIVED', async () => {
      const result = await service.archive('user-1', 'plan-1');
      expect(groups.assertCanModerate).toHaveBeenCalledWith('group-1', 'user-1');
      expect(prisma.groupReadingPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data: { status: 'ARCHIVED' },
      });
      expect(result).toBe(true);
    });

    it('should reject a non-moderator without updating', async () => {
      groups.assertCanModerate.mockRejectedValue(new ForbiddenException());
      await expect(service.archive('user-1', 'plan-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupReadingPlan.update).not.toHaveBeenCalled();
    });
  });

  // ── getActive ───────────────────────────────────────────────────────────────

  describe('getActive', () => {
    it('should reject a non-member with ForbiddenException', async () => {
      groups.getMembershipFor.mockResolvedValue(null);
      await expect(service.getActive('user-1', 'group-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.groupReadingPlan.findFirst).not.toHaveBeenCalled();
    });

    it('should reject a non-ACTIVE membership', async () => {
      groups.getMembershipFor.mockResolvedValue({ status: 'PENDING', role: 'MEMBER' });
      await expect(service.getActive('user-1', 'group-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return null when the group has no ACTIVE plan', async () => {
      prisma.groupReadingPlan.findFirst.mockResolvedValue(null);
      const result = await service.getActive('user-1', 'group-1');
      expect(result).toBeNull();
    });

    it('should query the ACTIVE plan for the group', async () => {
      await service.getActive('user-1', 'group-1');
      expect(prisma.groupReadingPlan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'group-1', status: 'ACTIVE' },
        }),
      );
    });

    it('should build a row for every ACTIVE member including zero progress', async () => {
      const result = await service.getActive('user-1', 'group-1');
      expect(result!.members).toHaveLength(2);
      expect(result!.members.map((m: any) => m.user.id)).toEqual(['user-1', 'user-2']);

      const withProgress = result!.members.find((m: any) => m.user.id === 'user-1');
      expect(withProgress).toEqual(
        expect.objectContaining({
          currentPage: 95,
          totalPages: 100,
          percent: 95,
          onPace: true,
        }),
      );

      const withoutProgress = result!.members.find((m: any) => m.user.id === 'user-2');
      expect(withoutProgress).toEqual(
        expect.objectContaining({
          currentPage: 0,
          totalPages: 100,
          percent: 0,
          onPace: false,
        }),
      );
    });

    it('should attach the derived expectedPercent (100 after the window)', async () => {
      const result = await service.getActive('user-1', 'group-1');
      expect(result!.expectedPercent).toBe(100);
    });

    it('should default totalPages to null when the book has no page count', async () => {
      prisma.groupReadingPlan.findFirst.mockResolvedValue({
        ...mockPlan,
        book: { ...planBook, totalPages: null },
      });
      const result = await service.getActive('user-1', 'group-1');
      expect(result!.members[0].totalPages).toBeNull();
      expect(result!.members[0].percent).toBe(0);
    });

    it('should query progress for the plan book only (no N+1)', async () => {
      await service.getActive('user-1', 'group-1');
      expect(prisma.bookProgress.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.bookProgress.findMany).toHaveBeenCalledWith({
        where: { bookId: 'book-1' },
      });
      expect(prisma.groupMember.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
