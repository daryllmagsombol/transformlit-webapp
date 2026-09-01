import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGroupInput, UpdateGroupInput } from './models/group.model.js';
import { GroupCategory } from '@transformlit/shared';
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

  async listGroups(userId?: string) {
    const groups = await this.prisma.group.findMany({
      where: { deletedAt: null },
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

  async findById(id: string, userId?: string) {
    const g = await this.prisma.group.findUnique({
      where: { id, deletedAt: null },
      include: groupInclude(userId),
    });
    if (!g) return null;
    return mapGroup(g, userId);
  }

  async findBySlug(slug: string, userId?: string) {
    const g = await this.prisma.group.findUnique({
      where: { slug, deletedAt: null },
      include: groupInclude(userId),
    });
    if (!g) return null;
    return mapGroup(g, userId);
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
    const member = await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: { status: group.visibility === 'PUBLIC' ? 'ACTIVE' : 'PENDING' },
      create: {
        groupId,
        userId,
        status: group.visibility === 'PUBLIC' ? 'ACTIVE' : 'PENDING',
      },
    });
    return member;
  }

  async leave(groupId: string, userId: string) {
    await this.prisma.groupMember.deleteMany({ where: { groupId, userId } });
    return true;
  }

  async updateGroup(groupId: string, input: UpdateGroupInput) {
    return this.prisma.group.update({ where: { id: groupId }, data: input });
  }

  async deleteGroup(groupId: string) {
    return this.prisma.group.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });
  }

  async searchGroups(query: string) {
    const groups = await this.prisma.group.findMany({
      where: { deletedAt: null, name: { contains: query, mode: 'insensitive' } },
      take: 20,
      include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
    });
    return groups.map((g) => mapGroup(g));
  }

  async listMembers(groupId: string) {
    return this.prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
  }
}
