/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { GroupFeaturesResolver } from './group-features.resolver';
import { ReadingPlansService } from './reading-plans.service';
import { SharedHighlightsService } from './shared-highlights.service';

const mockUser = { id: 'user-1' };

const mockPlan = {
  id: 'plan-1',
  groupId: 'group-1',
  bookId: 'book-1',
  title: 'October read',
  startDate: new Date('2026-10-01'),
  targetDate: new Date('2026-10-31'),
  status: 'ACTIVE',
  createdById: 'user-1',
  createdAt: new Date('2026-10-01'),
  expectedPercent: 25,
  members: [],
};

const mockShareRow = {
  id: 'share-1',
  groupId: 'group-1',
  highlightId: 'hl-1',
  sharedById: 'user-1',
  createdAt: new Date('2026-10-01'),
  deletedAt: null,
  sharedBy: { id: 'user-1', displayName: 'Ada', avatarUrl: null },
  highlight: {
    id: 'hl-1',
    bookId: 'book-1',
    page: 12,
    text: 'A quote',
    note: null,
    color: 'yellow',
    book: { title: 'The Book' },
  },
};

describe('GroupFeaturesResolver', () => {
  let resolver: GroupFeaturesResolver;
  let readingPlans: Record<string, jest.Mock>;
  let sharedHighlights: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockReadingPlans = {
      create: jest.fn().mockResolvedValue(mockPlan),
      archive: jest.fn().mockResolvedValue(true),
      getActive: jest.fn().mockResolvedValue(mockPlan),
    };
    const mockSharedHighlights = {
      share: jest.fn().mockResolvedValue(mockShareRow),
      unshare: jest.fn().mockResolvedValue(true),
      list: jest.fn().mockResolvedValue([mockShareRow]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupFeaturesResolver,
        { provide: ReadingPlansService, useValue: mockReadingPlans },
        { provide: SharedHighlightsService, useValue: mockSharedHighlights },
      ],
    }).compile();

    resolver = module.get<GroupFeaturesResolver>(GroupFeaturesResolver);
    readingPlans = module.get(ReadingPlansService) as any;
    sharedHighlights = module.get(SharedHighlightsService) as any;
    jest.clearAllMocks();
  });

  // ── groupReadingPlan query ──────────────────────────────────────────────────

  describe('groupReadingPlan', () => {
    it('should delegate to getActive with user id and groupId', async () => {
      const result = await resolver.groupReadingPlan(mockUser, 'group-1');
      expect(readingPlans.getActive).toHaveBeenCalledWith('user-1', 'group-1');
      expect(result).toEqual(mockPlan);
    });
  });

  // ── groupHighlights query ───────────────────────────────────────────────────

  describe('groupHighlights', () => {
    it('should delegate to list with user id, groupId and pagination', async () => {
      await resolver.groupHighlights(mockUser, 'group-1', 0, 25);
      expect(sharedHighlights.list).toHaveBeenCalledWith('user-1', 'group-1', 0, 25);
    });

    it('should forward custom pagination arguments', async () => {
      await resolver.groupHighlights(mockUser, 'group-1', 40, 10);
      expect(sharedHighlights.list).toHaveBeenCalledWith('user-1', 'group-1', 40, 10);
    });

    it('should flatten the join row into the SharedHighlight shape', async () => {
      const [result] = await resolver.groupHighlights(mockUser, 'group-1', 0, 25);
      expect(result).toEqual({
        id: 'share-1',
        groupId: 'group-1',
        createdAt: mockShareRow.createdAt,
        sharedBy: mockShareRow.sharedBy,
        highlight: {
          id: 'hl-1',
          bookId: 'book-1',
          bookTitle: 'The Book',
          page: 12,
          text: 'A quote',
          note: null,
          color: 'yellow',
        },
      });
    });
  });

  // ── createGroupReadingPlan mutation ─────────────────────────────────────────

  describe('createGroupReadingPlan', () => {
    it('should delegate to create with user id and input', async () => {
      const input = {
        groupId: 'group-1',
        bookId: 'book-1',
        title: 'October read',
        startDate: new Date('2026-10-01'),
        targetDate: new Date('2026-10-31'),
      };
      const result = await resolver.createGroupReadingPlan(mockUser, input);
      expect(readingPlans.create).toHaveBeenCalledWith('user-1', input);
      expect(result).toEqual(mockPlan);
    });
  });

  // ── archiveGroupReadingPlan mutation ────────────────────────────────────────

  describe('archiveGroupReadingPlan', () => {
    it('should delegate to archive with user id and planId', async () => {
      const result = await resolver.archiveGroupReadingPlan(mockUser, 'plan-1');
      expect(readingPlans.archive).toHaveBeenCalledWith('user-1', 'plan-1');
      expect(result).toBe(true);
    });
  });

  // ── shareHighlightToGroup mutation ──────────────────────────────────────────

  describe('shareHighlightToGroup', () => {
    it('should delegate to share with user id and input', async () => {
      const input = { groupId: 'group-1', highlightId: 'hl-1' };
      const result = await resolver.shareHighlightToGroup(mockUser, input);
      expect(sharedHighlights.share).toHaveBeenCalledWith('user-1', input);
      expect(result.id).toBe('share-1');
    });
  });

  // ── unshareHighlight mutation ───────────────────────────────────────────────

  describe('unshareHighlight', () => {
    it('should delegate to unshare with user id and shareId', async () => {
      const result = await resolver.unshareHighlight(mockUser, 'share-1');
      expect(sharedHighlights.unshare).toHaveBeenCalledWith('user-1', 'share-1');
      expect(result).toBe(true);
    });
  });

  // ── expectedPercent field resolver ──────────────────────────────────────────

  describe('expectedPercent', () => {
    it('should return the service-provided value without re-querying', async () => {
      const result = await resolver.expectedPercent(mockPlan as any, mockUser);
      expect(result).toBe(25);
      expect(readingPlans.getActive).not.toHaveBeenCalled();
    });

    it('should fall back to getActive when the plan has no derived value', async () => {
      const result = await resolver.expectedPercent(
        { ...mockPlan, expectedPercent: undefined } as any,
        mockUser,
      );
      expect(readingPlans.getActive).toHaveBeenCalledWith('user-1', 'group-1');
      expect(result).toBe(25);
    });
  });

  // ── members field resolver ──────────────────────────────────────────────────

  describe('members', () => {
    it('should return the service-provided rows without re-querying', async () => {
      const result = await resolver.members(mockPlan as any, mockUser);
      expect(result).toEqual([]);
      expect(readingPlans.getActive).not.toHaveBeenCalled();
    });

    it('should fall back to getActive when the plan has no member rows', async () => {
      const members = [{ currentPage: 0, totalPages: 100, percent: 0, onPace: true }];
      readingPlans.getActive.mockResolvedValue({ ...mockPlan, members });
      const result = await resolver.members(
        { ...mockPlan, members: undefined } as any,
        mockUser,
      );
      expect(readingPlans.getActive).toHaveBeenCalledWith('user-1', 'group-1');
      expect(result).toEqual(members);
    });
  });
});
