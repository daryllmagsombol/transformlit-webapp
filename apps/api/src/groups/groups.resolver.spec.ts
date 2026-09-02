/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { GroupsResolver } from './groups.resolver';
import { GroupsService } from './groups.service';
import type { Group } from './models/group.model';
import { GroupMemberRole, type GroupCategory, type GroupVisibility } from '@transformlit/shared';

const mockGroup = {
  id: 'group-1',
  name: 'Test Group',
  slug: 'test-group-1234567890',
  description: 'A test group',
  visibility: 'PUBLIC' as GroupVisibility,
  category: 'BIBLICAL_STUDIES' as GroupCategory,
  coverImageUrl: null,
  featured: false,
  memberCount: 3,
  myRole: 'OWNER' as const,
  createdAt: new Date('2024-01-01'),
};

const mockMember = {
  id: 'member-1',
  groupId: 'group-1',
  userId: 'user-1',
  role: 'OWNER' as const,
  status: 'ACTIVE' as const,
  joinedAt: new Date('2024-01-01'),
};

const mockUser = { id: 'user-1' };

describe('GroupsResolver', () => {
  let resolver: GroupsResolver;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockService = {
      countActiveMembers: jest.fn().mockResolvedValue(3),
      listGroups: jest.fn().mockResolvedValue([mockGroup]),
      myGroups: jest.fn().mockResolvedValue([mockGroup]),
      discoverGroups: jest.fn().mockResolvedValue([mockGroup]),
      findById: jest.fn().mockResolvedValue(mockGroup),
      searchGroups: jest.fn().mockResolvedValue([mockGroup]),
      listMembers: jest.fn().mockResolvedValue([mockMember]),
      create: jest.fn().mockResolvedValue({ ...mockGroup, memberCount: 1, myRole: 'OWNER' }),
      join: jest.fn().mockResolvedValue(mockMember),
      leave: jest.fn().mockResolvedValue(true),
      updateGroup: jest.fn().mockResolvedValue({ ...mockGroup, name: 'Updated' }),
      deleteGroup: jest.fn().mockResolvedValue({ ...mockGroup, deletedAt: new Date() }),
      approveMember: jest.fn().mockResolvedValue({ ...mockMember, status: 'ACTIVE' }),
      removeMember: jest.fn().mockResolvedValue(true),
      banMember: jest.fn().mockResolvedValue({ ...mockMember, status: 'BANNED' }),
      unbanMember: jest.fn().mockResolvedValue({ ...mockMember, status: 'ACTIVE' }),
      updateMemberRole: jest.fn().mockResolvedValue({ ...mockMember, role: 'MODERATOR' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsResolver,
        { provide: GroupsService, useValue: mockService },
      ],
    }).compile();

    resolver = module.get<GroupsResolver>(GroupsResolver);
    service = module.get(GroupsService) as any;
    jest.clearAllMocks();
  });

  // ── memberCount field resolver ──────────────────────────────────────────────

  describe('memberCount', () => {
    it('should return pre-computed memberCount if present on group', async () => {
      const group = { ...mockGroup, memberCount: 7 } as Group;
      const result = await resolver.memberCount(group);
      expect(result).toBe(7);
      expect(service.countActiveMembers).not.toHaveBeenCalled();
    });

    it('should delegate to countActiveMembers when memberCount is null', async () => {
      service.countActiveMembers.mockResolvedValue(5);
      const group = { ...mockGroup, memberCount: undefined } as Group;
      const result = await resolver.memberCount(group);
      expect(service.countActiveMembers).toHaveBeenCalledWith('group-1');
      expect(result).toBe(5);
    });
  });

  // ── groups query ────────────────────────────────────────────────────────────

  describe('groups', () => {
    it('should delegate to listGroups with user id', async () => {
      const result = await resolver.groups(mockUser);
      expect(service.listGroups).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([mockGroup]);
    });
  });

  // ── myGroups query ──────────────────────────────────────────────────────────

  describe('myGroups', () => {
    it('should delegate to myGroups with user id', async () => {
      const result = await resolver.myGroups(mockUser);
      expect(service.myGroups).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([mockGroup]);
    });
  });

  // ── discoverGroups query ────────────────────────────────────────────────────

  describe('discoverGroups', () => {
    it('should delegate to discoverGroups with user id and no category', async () => {
      const result = await resolver.discoverGroups(mockUser);
      expect(service.discoverGroups).toHaveBeenCalledWith('user-1', undefined);
      expect(result).toEqual([mockGroup]);
    });

    it('should pass category when provided', async () => {
      const result = await resolver.discoverGroups(mockUser, 'PHILOSOPHY' as GroupCategory);
      expect(service.discoverGroups).toHaveBeenCalledWith('user-1', 'PHILOSOPHY' as GroupCategory);
      expect(result).toEqual([mockGroup]);
    });
  });

  // ── group query ─────────────────────────────────────────────────────────────

  describe('group', () => {
    it('should delegate to findById with id and user id', async () => {
      const result = await resolver.group('group-1', mockUser);
      expect(service.findById).toHaveBeenCalledWith('group-1', 'user-1');
      expect(result).toEqual(mockGroup);
    });
  });

  // ── searchGroups query ──────────────────────────────────────────────────────

  describe('searchGroups', () => {
    it('should delegate to searchGroups with query string', async () => {
      const result = await resolver.searchGroups('test');
      expect(service.searchGroups).toHaveBeenCalledWith('test');
      expect(result).toEqual([mockGroup]);
    });
  });

  // ── groupMembers query ──────────────────────────────────────────────────────

  describe('groupMembers', () => {
    it('should delegate to listMembers with groupId', async () => {
      const result = await resolver.groupMembers('group-1');
      expect(service.listMembers).toHaveBeenCalledWith('group-1');
      expect(result).toEqual([mockMember]);
    });
  });

  // ── createGroup mutation ────────────────────────────────────────────────────

  describe('createGroup', () => {
    it('should delegate to create with user id and input', async () => {
      const input = { name: 'New Group', description: 'Desc', visibility: 'PUBLIC' as GroupVisibility };
      const result = await resolver.createGroup(mockUser, input);
      expect(service.create).toHaveBeenCalledWith('user-1', input);
      expect(result).toEqual(expect.objectContaining({ memberCount: 1, myRole: 'OWNER' }));
    });
  });

  // ── joinGroup mutation ──────────────────────────────────────────────────────

  describe('joinGroup', () => {
    it('should delegate to join with groupId and user id', async () => {
      const result = await resolver.joinGroup(mockUser, 'group-1');
      expect(service.join).toHaveBeenCalledWith('group-1', 'user-1');
      expect(result).toEqual(mockMember);
    });
  });

  // ── leaveGroup mutation ─────────────────────────────────────────────────────

  describe('leaveGroup', () => {
    it('should delegate to leave with groupId and user id', async () => {
      const result = await resolver.leaveGroup(mockUser, 'group-1');
      expect(service.leave).toHaveBeenCalledWith('group-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  // ── updateGroup mutation ────────────────────────────────────────────────────

  describe('updateGroup', () => {
    it('should delegate to updateGroup with groupId and input', async () => {
      const input = { name: 'Updated' };
      const result = await resolver.updateGroup('group-1', input);
      expect(service.updateGroup).toHaveBeenCalledWith('group-1', input);
      expect(result).toEqual(expect.objectContaining({ name: 'Updated' }));
    });
  });

  // ── deleteGroup mutation ────────────────────────────────────────────────────

  describe('deleteGroup', () => {
    it('should delegate to deleteGroup with groupId', async () => {
      const result = await resolver.deleteGroup('group-1');
      expect(service.deleteGroup).toHaveBeenCalledWith('group-1');
      expect(result).toEqual(expect.objectContaining({ deletedAt: expect.any(Date) }));
    });
  });

  // ── approveGroupMember mutation ─────────────────────────────────────────────

  describe('approveGroupMember', () => {
    it('should delegate to approveMember with groupId, user id, and target userId', async () => {
      const result = await resolver.approveGroupMember(mockUser, 'group-1', 'user-2');
      expect(service.approveMember).toHaveBeenCalledWith('group-1', 'user-1', 'user-2');
      expect(result).toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    });
  });

  // ── removeGroupMember mutation ──────────────────────────────────────────────

  describe('removeGroupMember', () => {
    it('should delegate to removeMember with groupId, user id, and target userId', async () => {
      const result = await resolver.removeGroupMember(mockUser, 'group-1', 'user-2');
      expect(service.removeMember).toHaveBeenCalledWith('group-1', 'user-1', 'user-2');
      expect(result).toBe(true);
    });
  });

  // ── banGroupMember mutation ─────────────────────────────────────────────────

  describe('banGroupMember', () => {
    it('should delegate to banMember with groupId, user id, and target userId', async () => {
      const result = await resolver.banGroupMember(mockUser, 'group-1', 'user-2');
      expect(service.banMember).toHaveBeenCalledWith('group-1', 'user-1', 'user-2');
      expect(result).toEqual(expect.objectContaining({ status: 'BANNED' }));
    });
  });

  // ── unbanGroupMember mutation ───────────────────────────────────────────────

  describe('unbanGroupMember', () => {
    it('should delegate to unbanMember with groupId, user id, and target userId', async () => {
      const result = await resolver.unbanGroupMember(mockUser, 'group-1', 'user-2');
      expect(service.unbanMember).toHaveBeenCalledWith('group-1', 'user-1', 'user-2');
      expect(result).toEqual(expect.objectContaining({ status: 'ACTIVE' }));
    });
  });

  // ── updateGroupMemberRole mutation ──────────────────────────────────────────

  describe('updateGroupMemberRole', () => {
    it('should delegate to updateMemberRole with MODERATOR role', async () => {
      const result = await resolver.updateGroupMemberRole(mockUser, 'group-1', 'user-2', GroupMemberRole.MODERATOR);
      expect(service.updateMemberRole).toHaveBeenCalledWith('group-1', 'user-1', 'user-2', 'MODERATOR');
      expect(result).toEqual(expect.objectContaining({ role: 'MODERATOR' }));
    });

    it('should delegate to updateMemberRole with MEMBER role', async () => {
      await resolver.updateGroupMemberRole(mockUser, 'group-1', 'user-2', GroupMemberRole.MEMBER);
      expect(service.updateMemberRole).toHaveBeenCalledWith('group-1', 'user-1', 'user-2', 'MEMBER');
    });
  });
});
