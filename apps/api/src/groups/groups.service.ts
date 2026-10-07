import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGroupInput, UpdateGroupInput } from './models/group.model.js';
import { GroupCategory, GroupVisibility, UserRole } from '@transformlit/shared';
import { Prisma } from '@prisma/client';

/** Max page size accepted by the staff-only group admin listing. */
const ADMIN_GROUPS_MAX_PAGE_SIZE = 100;

/** A synthetic membership returned to global staff who moderate a group they do not belong to. */
const STAFF_MODERATOR = { role: 'MODERATOR' as const, status: 'ACTIVE' as const };

/** True when a global (platform) role is allowed to moderate any group without membership. */
function isGlobalStaff(role?: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR;
}

/** Reusable include to count active members and fetch the current user's membership */
function groupInclude(userId?: string) {
  return {
    members: userId ? { where: { userId } } : false,
    _count: {
      select: { members: { where: { status: 'ACTIVE' } } },
    },
  } satisfies Prisma.GroupInclude;
}

/** Map raw Prisma result → Group shape (memberCount, myRole, myStatus from members) */
function mapGroup(g: any, userId?: string) {
  return {
    ...g,
    memberCount: g._count?.members ?? 0,
    myRole: g.members?.[0]?.role ?? null,
    myStatus: g.members?.[0]?.status ?? null,
  };
}

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  async listGroups(userId: string) {
    const groups = await this.prisma.group.findMany({
      where: {
        deletedAt: null,
        OR: [
          { visibility: 'PUBLIC' },
          { members: { some: { userId, status: 'ACTIVE' } } },
        ],
      },
      include: groupInclude(userId),
      orderBy: { createdAt: 'desc' },
    });
    return groups.map((g) => mapGroup(g, userId));
  }

  /** Groups the current user is an ACTIVE member of */
  async myGroups(userId: string) {
    const groups = await this.prisma.group.findMany({
      where: {
        deletedAt: null,
        members: { some: { userId, status: 'ACTIVE' } },
      },
      include: groupInclude(userId),
      orderBy: { updatedAt: 'desc' },
    });
    return groups.map((g) => mapGroup(g, userId));
  }

  /** Discover groups: public groups the user is NOT a member of, optionally filtered by category */
  async discoverGroups(userId: string, category?: GroupCategory) {
    const where: Prisma.GroupWhereInput = {
      deletedAt: null,
      visibility: 'PUBLIC',
      ...(category && { category }),
      members: { none: { userId } },
    };

    const groups = await this.prisma.group.findMany({
      where,
      include: groupInclude(userId),
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    });
    return groups.map((g) => mapGroup(g, userId));
  }

  /** Count of ACTIVE members in a group */
  async countActiveMembers(groupId: string): Promise<number> {
    return this.prisma.groupMember.count({
      where: { groupId, status: 'ACTIVE' },
    });
  }

  async findById(id: string, userId: string) {
    const g = await this.prisma.group.findUnique({
      where: { id, deletedAt: null },
      include: groupInclude(userId),
    });
    if (!g) return null;
    if (!(await this.canView(g, userId))) return null;
    return mapGroup(g, userId);
  }

  async findBySlug(slug: string, userId: string) {
    const g = await this.prisma.group.findUnique({
      where: { slug, deletedAt: null },
      include: groupInclude(userId),
    });
    if (!g) return null;
    if (!(await this.canView(g, userId))) return null;
    return mapGroup(g, userId);
  }

  /** A group is viewable when it is PUBLIC or the requester is an ACTIVE member (no existence leak). */
  private async canView(
    group: { id: string; visibility: string },
    requesterId: string,
  ): Promise<boolean> {
    if (group.visibility === 'PUBLIC') return true;
    const m = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: requesterId } },
    });
    return m?.status === 'ACTIVE';
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  async create(userId: string, input: CreateGroupInput) {
    const slug = input.name
      .toLowerCase()
      .replaceAll(/\s+/g, '-')
      .replaceAll(/[^a-z0-9-]/g, '');
    const group = await this.prisma.group.create({
      data: {
        name: input.name,
        slug: `${slug}-${Date.now()}`,
        description: input.description,
        visibility: input.visibility ?? 'PUBLIC',
        category: input.category,
        coverImageUrl: input.coverImageUrl,
        createdById: userId,
      },
    });
    await this.prisma.groupMember.create({
      data: { groupId: group.id, userId, role: 'OWNER', status: 'ACTIVE' },
    });
    return { ...group, memberCount: 1, myRole: 'OWNER' };
  }

  async join(groupId: string, userId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new Error('Group not found');
    const existing = await this.getMembershipFor(groupId, userId);
    if (existing?.status === 'BANNED') {
      throw new ForbiddenException('You are banned from this group');
    }
    const status = group.visibility === 'PUBLIC' ? 'ACTIVE' : 'PENDING';
    if (existing) {
      return this.prisma.groupMember.update({
        where: { id: existing.id },
        data: { status },
      });
    }
    return this.prisma.groupMember.create({
      data: { groupId, userId, status },
    });
  }

  async leave(groupId: string, userId: string) {
    const membership = await this.getMembershipFor(groupId, userId);
    if (membership?.role === 'OWNER') {
      const ownerCount = await this.prisma.groupMember.count({
        where: { groupId, role: 'OWNER', status: 'ACTIVE' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Transfer ownership before leaving');
      }
    }
    await this.prisma.groupMember.deleteMany({ where: { groupId, userId } });
    return true;
  }

  async updateGroup(
    groupId: string,
    actorId: string,
    input: UpdateGroupInput,
    actorRole: UserRole,
  ) {
    await this.assertCanManageGroup(groupId, actorId, actorRole);
    return this.prisma.group.update({ where: { id: groupId }, data: input });
  }

  async deleteGroup(groupId: string, actorId: string, actorRole: UserRole) {
    await this.assertCanManageGroup(groupId, actorId, actorRole, { ownerOnly: true });
    return this.prisma.group.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });
  }

  async searchGroups(query: string, userId: string) {
    const groups = await this.prisma.group.findMany({
      where: {
        deletedAt: null,
        name: { contains: query, mode: 'insensitive' },
        OR: [
          { visibility: 'PUBLIC' },
          { members: { some: { userId, status: 'ACTIVE' } } },
        ],
      },
      take: 20,
      include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
    });
    return groups.map((g) => mapGroup(g, userId));
  }

  async listMembers(groupId: string, requesterId: string, requesterRole?: UserRole) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    const staff = isGlobalStaff(requesterRole);
    if (!staff && !(await this.canView(group, requesterId))) {
      throw new ForbiddenException('You do not have access to this group');
    }
    const requesterMembership = await this.getMembershipFor(groupId, requesterId);
    const isModerator =
      staff ||
      (requesterMembership?.status === 'ACTIVE' &&
        (requesterMembership.role === 'OWNER' || requesterMembership.role === 'MODERATOR'));

    return this.prisma.groupMember.findMany({
      where: isModerator ? { groupId } : { groupId, status: 'ACTIVE' },
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async getMembershipFor(groupId: string, userId: string) {
    return this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  }

  /**
   * Public so sibling domains (e.g. group-features) reuse the same owner/mod gate.
   * A global (platform) ADMIN/MODERATOR bypasses group membership and receives a
   * synthetic moderator actor. An ACTIVE group OWNER/MODERATOR membership still
   * wins so global staff never lose the capabilities of their own groups. The
   * third argument stays optional to keep the two-argument sibling callers valid.
   */
  async assertCanModerate(groupId: string, actorId: string, actorRole?: UserRole) {
    const membership = await this.getMembershipFor(groupId, actorId);
    if (
      membership?.status === 'ACTIVE' &&
      (membership.role === 'OWNER' || membership.role === 'MODERATOR')
    ) {
      return membership;
    }
    if (isGlobalStaff(actorRole)) {
      return STAFF_MODERATOR;
    }
    throw new ForbiddenException('You need to be an owner or moderator');
  }

  /** ACTIVE owner/moderator (or a platform ADMIN) may update; delete requires an ACTIVE OWNER or platform ADMIN. */
  private async assertCanManageGroup(
    groupId: string,
    actorId: string,
    actorRole: UserRole,
    opts: { ownerOnly?: boolean } = {},
  ) {
    if (actorRole === UserRole.ADMIN) return;
    const membership = await this.getMembershipFor(groupId, actorId);
    const canManage =
      membership?.status === 'ACTIVE' &&
      (opts.ownerOnly ? membership.role === 'OWNER' : membership.role !== 'MEMBER');
    if (!canManage) {
      throw new ForbiddenException(
        opts.ownerOnly
          ? 'Only the group owner can delete this group'
          : 'You need to be an owner or moderator',
      );
    }
  }

  async approveMember(groupId: string, actorId: string, userId: string, actorRole?: UserRole) {
    await this.assertCanModerate(groupId, actorId, actorRole);
    const target = await this.getMembershipFor(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.status !== 'PENDING') {
      throw new BadRequestException('Only pending members can be approved');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { status: 'ACTIVE' },
    });
  }

  async removeMember(
    groupId: string,
    actorId: string,
    userId: string,
    actorRole?: UserRole,
  ) {
    const actor = await this.assertCanModerate(groupId, actorId, actorRole);
    const target = await this.getMembershipFor(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the group owner');
    }
    if (
      actorRole !== UserRole.ADMIN &&
      actor.role === 'MODERATOR' &&
      target.role === 'MODERATOR'
    ) {
      throw new ForbiddenException('Moderators cannot remove other moderators');
    }
    await this.prisma.groupMember.delete({ where: { id: target.id } });
    return true;
  }

  async banMember(groupId: string, actorId: string, userId: string, actorRole?: UserRole) {
    await this.assertCanModerate(groupId, actorId, actorRole);
    const target = await this.getMembershipFor(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot ban the group owner');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { status: 'BANNED' },
    });
  }

  async unbanMember(groupId: string, actorId: string, userId: string, actorRole?: UserRole) {
    await this.assertCanModerate(groupId, actorId, actorRole);
    const target = await this.getMembershipFor(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.status !== 'BANNED') {
      throw new BadRequestException('Member is not banned');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { status: 'ACTIVE' },
    });
  }

  async updateMemberRole(
    groupId: string,
    actorId: string,
    userId: string,
    role: 'MEMBER' | 'MODERATOR',
    actorRole?: UserRole,
  ) {
    const actor = await this.assertCanModerate(groupId, actorId, actorRole);
    const isGlobalAdmin = actorRole === UserRole.ADMIN;
    if (!isGlobalAdmin && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can change roles');
    }
    const target = await this.getMembershipFor(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot change the owner role');
    }
    if (role !== 'MEMBER' && role !== 'MODERATOR') {
      throw new BadRequestException('Role must be MEMBER or MODERATOR');
    }
    return this.prisma.groupMember.update({
      where: { id: target.id },
      data: { role },
    });
  }

  // ── Staff-only admin listing ────────────────────────────────────────────────

  /**
   * Staff-only paginated listing of ALL non-deleted groups (private included),
   * each annotated with active and pending member counts. Callers are expected
   * to be gated by RolesGuard(ADMIN, MODERATOR).
   */
  async adminGroups(
    filter: { query?: string; visibility?: GroupVisibility },
    page: number,
    pageSize: number,
  ) {
    const safePage = Math.max(1, Math.trunc(page) || 1);
    const safePageSize = Math.min(
      ADMIN_GROUPS_MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(pageSize) || 25),
    );

    const where: Prisma.GroupWhereInput = {
      deletedAt: null,
      ...(filter.visibility && { visibility: filter.visibility }),
      ...(filter.query && {
        name: { contains: filter.query, mode: 'insensitive' },
      }),
    };

    const [groups, total] = await Promise.all([
      this.prisma.group.findMany({
        where,
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.group.count({ where }),
    ]);

    const items = await this.attachMemberCounts(groups);

    return { items, total, page: safePage, pageSize: safePageSize };
  }

  /** Batch-load ACTIVE/PENDING counts for a page of groups (one groupBy query). */
  private async attachMemberCounts<T extends { id: string }>(groups: T[]) {
    if (groups.length === 0) return [] as (T & { activeMemberCount: number; pendingMemberCount: number })[];
    const groupIds = groups.map((g) => g.id);
    const counts = await this.prisma.groupMember.groupBy({
      by: ['groupId', 'status'],
      where: { groupId: { in: groupIds }, status: { in: ['ACTIVE', 'PENDING'] } },
      _count: { _all: true },
    });

    const byGroup = new Map<string, { active: number; pending: number }>();
    for (const row of counts) {
      const entry = byGroup.get(row.groupId) ?? { active: 0, pending: 0 };
      if (row.status === 'ACTIVE') entry.active = row._count._all;
      if (row.status === 'PENDING') entry.pending = row._count._all;
      byGroup.set(row.groupId, entry);
    }

    return groups.map((g) => {
      const entry = byGroup.get(g.id) ?? { active: 0, pending: 0 };
      return { ...g, activeMemberCount: entry.active, pendingMemberCount: entry.pending };
    });
  }
}
