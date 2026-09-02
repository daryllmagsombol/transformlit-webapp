/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from '../prisma/prisma.service';
import type { GroupCategory, GroupVisibility } from '@transformlit/shared';

const mockGroup = {
  id: 'group-1',
  name: 'Test Group',
  slug: 'test-group-1234567890',
  description: 'A test group',
  visibility: 'PUBLIC',
  category: 'BIBLICAL_STUDIES',
  coverImageUrl: null,
  featured: false,
  createdById: 'user-1',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
};

const mockMember = {
  id: 'member-1',
  groupId: 'group-1',
  userId: 'user-1',
  role: 'OWNER',
  status: 'ACTIVE',
  joinedAt: new Date('2024-01-01'),
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
};

function groupWithCount(g: any, activeCount = 3, members: any[] = []) {
  return {
    ...g,
    _count: { members: activeCount },
    members,
  };
}

describe('GroupsService', () => {
  let service: GroupsService;
  let prisma: any;

  beforeEach(async () => {
    const mockPrisma = {
      group: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(mockGroup),
        create: jest.fn().mockResolvedValue(mockGroup),
        update: jest.fn().mockResolvedValue(mockGroup),
      },
      groupMember: {
        count: jest.fn().mockResolvedValue(3),
        create: jest.fn().mockResolvedValue(mockMember),
        upsert: jest.fn().mockResolvedValue(mockMember),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ ...mockMember, user: mockUser }]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(mockMember),
        delete: jest.fn().mockResolvedValue(mockMember),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();

    prisma.group.findMany.mockResolvedValue([]);
    prisma.group.findUnique.mockResolvedValue(mockGroup);
    prisma.group.create.mockResolvedValue(mockGroup);
    prisma.group.update.mockResolvedValue(mockGroup);
    prisma.groupMember.count.mockResolvedValue(3);
    prisma.groupMember.create.mockResolvedValue(mockMember);
    prisma.groupMember.upsert.mockResolvedValue(mockMember);
    prisma.groupMember.deleteMany.mockResolvedValue({ count: 1 });
    prisma.groupMember.findMany.mockResolvedValue([{ ...mockMember, user: mockUser }]);
    prisma.groupMember.findUnique.mockResolvedValue(null);
    prisma.groupMember.update.mockResolvedValue(mockMember);
    prisma.groupMember.delete.mockResolvedValue(mockMember);
  });

  // ── listGroups ──────────────────────────────────────────────────────────────

  describe('listGroups', () => {
    it('should find non-deleted groups', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup)]);
      await service.listGroups();
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
        }),
      );
    });

    it('should include ACTIVE member count via _count', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup, 5)]);
      const result = await service.listGroups();
      expect(result[0].memberCount).toBe(5);
    });

    it('should include user role when userId provided', async () => {
      const withRole = groupWithCount(mockGroup, 3, [{ role: 'OWNER', userId: 'user-1' }]);
      prisma.group.findMany.mockResolvedValue([withRole]);
      const result = await service.listGroups('user-1');
      expect(result[0].myRole).toBe('OWNER');
    });

    it('should return null myRole when userId not provided', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup, 3)]);
      const result = await service.listGroups();
      expect(result[0].myRole).toBeNull();
    });

    it('should map via mapGroup helper', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup, 7)]);
      const result = await service.listGroups();
      expect(result[0]).toEqual(
        expect.objectContaining({
          ...mockGroup,
          memberCount: 7,
          myRole: null,
        }),
      );
    });

    it('should order by createdAt descending', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.listGroups();
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  // ── myGroups ────────────────────────────────────────────────────────────────

  describe('myGroups', () => {
    it('should find groups where user is ACTIVE member', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup)]);
      await service.myGroups('user-1');
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            members: { some: { userId: 'user-1', status: 'ACTIVE' } },
          },
        }),
      );
    });

    it('should order by updatedAt descending', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.myGroups('user-1');
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });

    it('should include member count and user role', async () => {
      const withRole = groupWithCount(mockGroup, 2, [{ role: 'MEMBER', userId: 'user-1' }]);
      prisma.group.findMany.mockResolvedValue([withRole]);
      const result = await service.myGroups('user-1');
      expect(result[0].memberCount).toBe(2);
      expect(result[0].myRole).toBe('MEMBER');
    });
  });

  // ── discoverGroups ──────────────────────────────────────────────────────────

  describe('discoverGroups', () => {
    it('should find PUBLIC groups user is NOT a member of', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.discoverGroups('user-1');
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            visibility: 'PUBLIC',
            members: { none: { userId: 'user-1' } },
          }),
        }),
      );
    });

    it('should filter by category if provided', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.discoverGroups('user-1', 'PHILOSOPHY' as GroupCategory);
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: 'PHILOSOPHY' as GroupCategory,
          }),
        }),
      );
    });

    it('should not include category filter when not provided', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.discoverGroups('user-1');
      const call = prisma.group.findMany.mock.calls[0][0];
      expect(call.where.category).toBeUndefined();
    });

    it('should order by featured desc, createdAt desc', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.discoverGroups('user-1');
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('should return mapped groups with memberCount', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup, 10)]);
      const result = await service.discoverGroups('user-1');
      expect(result[0].memberCount).toBe(10);
    });
  });

  // ── countActiveMembers ──────────────────────────────────────────────────────

  describe('countActiveMembers', () => {
    it('should count ACTIVE members for a group', async () => {
      prisma.groupMember.count.mockResolvedValue(5);
      const result = await service.countActiveMembers('group-1');
      expect(prisma.groupMember.count).toHaveBeenCalledWith({
        where: { groupId: 'group-1', status: 'ACTIVE' },
      });
      expect(result).toBe(5);
    });

    it('should return 0 when no active members', async () => {
      prisma.groupMember.count.mockResolvedValue(0);
      const result = await service.countActiveMembers('group-1');
      expect(result).toBe(0);
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should find group by id where deletedAt is null', async () => {
      prisma.group.findUnique.mockResolvedValue(groupWithCount(mockGroup));
      await service.findById('group-1');
      expect(prisma.group.findUnique).toHaveBeenCalledWith({
        where: { id: 'group-1', deletedAt: null },
        include: expect.any(Object),
      });
    });

    it('should return null if not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });

    it('should include member count and user role', async () => {
      const withRole = groupWithCount(mockGroup, 4, [{ role: 'OWNER', userId: 'user-1' }]);
      prisma.group.findUnique.mockResolvedValue(withRole);
      const result = await service.findById('group-1', 'user-1');
      expect(result).toEqual(
        expect.objectContaining({
          memberCount: 4,
          myRole: 'OWNER',
        }),
      );
    });

    it('should include member count without userId', async () => {
      prisma.group.findUnique.mockResolvedValue(groupWithCount(mockGroup, 8));
      const result = await service.findById('group-1');
      expect(result).toEqual(
        expect.objectContaining({
          memberCount: 8,
          myRole: null,
        }),
      );
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const input = {
      name: 'My Cool Group',
      description: 'A description',
      visibility: 'PUBLIC' as GroupVisibility,
      category: 'PHILOSOPHY' as GroupCategory,
    };

    it('should generate slug from name (lowercase, hyphens, timestamp)', async () => {
      await service.create('user-1', input);
      expect(prisma.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: expect.stringMatching(/^my-cool-group-\d+$/),
          }),
        }),
      );
    });

    it('should create group in Prisma with correct data', async () => {
      await service.create('user-1', input);
      expect(prisma.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'My Cool Group',
            description: 'A description',
            visibility: 'PUBLIC',
            category: 'PHILOSOPHY',
            createdById: 'user-1',
          }),
        }),
      );
    });

    it('should default visibility to PUBLIC when not provided', async () => {
      const inputNoVis = { name: 'Test' };
      await service.create('user-1', inputNoVis);
      expect(prisma.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: 'PUBLIC',
          }),
        }),
      );
    });

    it('should create OWNER membership with ACTIVE status', async () => {
      await service.create('user-1', input);
      expect(prisma.groupMember.create).toHaveBeenCalledWith({
        data: {
          groupId: mockGroup.id,
          userId: 'user-1',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
    });

    it('should return group with memberCount: 1 and myRole: OWNER', async () => {
      const result = await service.create('user-1', input);
      expect(result).toEqual(
        expect.objectContaining({
          ...mockGroup,
          memberCount: 1,
          myRole: 'OWNER',
        }),
      );
    });

    it('should strip special characters from slug', async () => {
      await service.create('user-1', { name: 'Hello! @World# 123' });
      expect(prisma.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: expect.stringMatching(/^hello-world-123-\d+$/),
          }),
        }),
      );
    });
  });

  // ── join ────────────────────────────────────────────────────────────────────

  describe('join', () => {
    it('should throw Error if group not found', async () => {
      prisma.group.findUnique.mockResolvedValue(null);
      await expect(service.join('bad-id', 'user-1')).rejects.toThrow('Group not found');
    });

    it('should upsert membership with ACTIVE status for PUBLIC groups', async () => {
      prisma.group.findUnique.mockResolvedValue({ ...mockGroup, visibility: 'PUBLIC' });
      await service.join('group-1', 'user-1');
      expect(prisma.groupMember.upsert).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'group-1', userId: 'user-1' } },
        update: { status: 'ACTIVE' },
        create: { groupId: 'group-1', userId: 'user-1', status: 'ACTIVE' },
      });
    });

    it('should upsert membership with PENDING status for PRIVATE groups', async () => {
      prisma.group.findUnique.mockResolvedValue({ ...mockGroup, visibility: 'PRIVATE' });
      await service.join('group-1', 'user-1');
      expect(prisma.groupMember.upsert).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'group-1', userId: 'user-1' } },
        update: { status: 'PENDING' },
        create: { groupId: 'group-1', userId: 'user-1', status: 'PENDING' },
      });
    });

    it('should return the upserted member', async () => {
      prisma.group.findUnique.mockResolvedValue({ ...mockGroup, visibility: 'PUBLIC' });
      const result = await service.join('group-1', 'user-1');
      expect(result).toEqual(mockMember);
    });
  });

  // ── leave ───────────────────────────────────────────────────────────────────

  describe('leave', () => {
    it('should delete membership', async () => {
      await service.leave('group-1', 'user-1');
      expect(prisma.groupMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', userId: 'user-1' },
      });
    });

    it('should return true', async () => {
      const result = await service.leave('group-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  // ── updateGroup ─────────────────────────────────────────────────────────────

  describe('updateGroup', () => {
    it('should update group with provided fields', async () => {
      const input = { name: 'Updated Name', description: 'Updated desc' };
      await service.updateGroup('group-1', input);
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: input,
      });
    });

    it('should return updated group', async () => {
      const updated = { ...mockGroup, name: 'Updated Name' };
      prisma.group.update.mockResolvedValue(updated);
      const result = await service.updateGroup('group-1', { name: 'Updated Name' });
      expect(result).toEqual(updated);
    });
  });

  // ── deleteGroup ─────────────────────────────────────────────────────────────

  describe('deleteGroup', () => {
    it('should soft delete by setting deletedAt', async () => {
      await service.deleteGroup('group-1');
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      });
    });

    it('should return updated group', async () => {
      const deleted = { ...mockGroup, deletedAt: new Date('2024-06-01') };
      prisma.group.update.mockResolvedValue(deleted);
      const result = await service.deleteGroup('group-1');
      expect(result).toEqual(deleted);
    });
  });

  // ── searchGroups ────────────────────────────────────────────────────────────

  describe('searchGroups', () => {
    it('should search case-insensitive by name', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.searchGroups('test');
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            name: { contains: 'test', mode: 'insensitive' },
          },
        }),
      );
    });

    it('should limit to 20 results', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      await service.searchGroups('test');
      expect(prisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it('should include ACTIVE member count', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup, 12)]);
      const result = await service.searchGroups('test');
      expect(result[0].memberCount).toBe(12);
    });

    it('should return mapped groups', async () => {
      prisma.group.findMany.mockResolvedValue([groupWithCount(mockGroup, 5)]);
      const result = await service.searchGroups('test');
      expect(result[0]).toEqual(
        expect.objectContaining({
          ...mockGroup,
          memberCount: 5,
          myRole: null,
        }),
      );
    });
  });

  // ── listMembers ─────────────────────────────────────────────────────────────

  describe('listMembers', () => {
    it('should find all members for a group', async () => {
      await service.listMembers('group-1');
      expect(prisma.groupMember.findMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1' },
        include: { user: true },
        orderBy: { joinedAt: 'asc' },
      });
    });

    it('should include user objects', async () => {
      const result = await service.listMembers('group-1');
      expect(result[0].user).toEqual(mockUser);
    });

    it('should order by joinedAt ascending', async () => {
      await service.listMembers('group-1');
      expect(prisma.groupMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { joinedAt: 'asc' },
        }),
      );
    });

    it('should return empty array when no members', async () => {
      prisma.groupMember.findMany.mockResolvedValue([]);
      const result = await service.listMembers('group-1');
      expect(result).toEqual([]);
    });
  });

  // ── member management ──────────────────────────────────────────────────────

  describe('member management', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('approveMember activates a pending member for an owner', async () => {
      prisma.groupMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' }) // actor
        .mockResolvedValueOnce({ id: 'm2', status: 'PENDING' }); // target
      prisma.groupMember.update.mockResolvedValue({ id: 'm2', status: 'ACTIVE' });
      const result = await service.approveMember('g1', 'u1', 'u2');
      expect(result.status).toBe('ACTIVE');
      expect(prisma.groupMember.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
    });

    it('blocks non-moderators from approving', async () => {
      prisma.groupMember.findUnique.mockResolvedValueOnce({
        role: 'MEMBER',
        status: 'ACTIVE',
      });
      await expect(service.approveMember('g1', 'u1', 'u2')).rejects.toThrow();
    });

    it('prevents removing the owner', async () => {
      prisma.groupMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' })
        .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' });
      await expect(service.removeMember('g1', 'u1', 'u2')).rejects.toThrow(
        'Cannot remove the group owner',
      );
    });

    it('promotes a member to MODERATOR only for the owner', async () => {
      prisma.groupMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER', status: 'ACTIVE' })
        .mockResolvedValueOnce({ role: 'MEMBER', status: 'ACTIVE' });
      prisma.groupMember.update.mockResolvedValue({ role: 'MODERATOR' });
      const result = await service.updateMemberRole('g1', 'u1', 'u2', 'MODERATOR');
      expect(result.role).toBe('MODERATOR');
    });
  });
});
