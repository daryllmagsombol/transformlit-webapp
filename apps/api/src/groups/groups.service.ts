import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGroupInput, UpdateGroupInput } from './models/group.model.js';
import { GroupCategory, UserRole } from '@transformlit/shared';
import { Prisma } from '@prisma/client';

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
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
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

  async listMembers(groupId: string, requesterId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (!(await this.canView(group, requesterId))) {
      throw new ForbiddenException('You do not have access to this group');
    }
    const requesterMembership = await this.getMembershipFor(groupId, requesterId);
    const isModerator =
      requesterMembership?.status === 'ACTIVE' &&
      (requesterMembership.role === 'OWNER' || requesterMembership.role === 'MODERATOR');

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

  private async assertCanModerate(groupId: string, actorId: string) {
    const membership = await this.getMembershipFor(groupId, actorId);
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      (membership.role !== 'OWNER' && membership.role !== 'MODERATOR')
    ) {
      throw new ForbiddenException('You need to be an owner or moderator');
    }
    return membership;
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

  async approveMember(groupId: string, actorId: string, userId: string) {
    await this.assertCanModerate(groupId, actorId);
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

  async removeMember(groupId: string, actorId: string, userId: string) {
    const actor = await this.assertCanModerate(groupId, actorId);
    const target = await this.getMembershipFor(groupId, userId);
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the group owner');
    }
    if (
      actor.role === 'MODERATOR' &&
      target.role === 'MODERATOR'
    ) {
      throw new ForbiddenException('Moderators cannot remove other moderators');
    }
    await this.prisma.groupMember.delete({ where: { id: target.id } });
    return true;
  }

  async banMember(groupId: string, actorId: string, userId: string) {
    await this.assertCanModerate(groupId, actorId);
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

  async unbanMember(groupId: string, actorId: string, userId: string) {
    await this.assertCanModerate(groupId, actorId);
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
  ) {
    const actor = await this.assertCanModerate(groupId, actorId);
    if (actor.role !== 'OWNER') {
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
}
