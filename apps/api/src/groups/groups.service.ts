import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGroupInput, UpdateGroupInput } from '@transformlit/shared';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async listGroups(userId?: string) {
    const groups = await this.prisma.group.findMany({
      where: { deletedAt: null },
      include: { members: { where: { userId } }, _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return groups.map((g) => ({
      ...g,
      memberCount: g._count.members,
      myRole: g.members[0]?.role ?? null,
    }));
  }

  async findById(id: string, userId?: string) {
    const g = await this.prisma.group.findUnique({
      where: { id, deletedAt: null },
      include: { members: { where: { userId } }, _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
    });
    if (!g) return null;
    return { ...g, memberCount: g._count.members, myRole: g.members[0]?.role ?? null };
  }

  async create(userId: string, input: CreateGroupInput) {
    const slug = input.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const group = await this.prisma.group.create({
      data: { ...input, slug: `${slug}-${Date.now()}`, createdById: userId },
    });
    await this.prisma.groupMember.create({
      data: { groupId: group.id, userId, role: 'OWNER', status: 'ACTIVE' },
    });
    return group;
  }

  async join(groupId: string, userId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new Error('Group not found');
    const member = await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: { status: group.visibility === 'PUBLIC' ? 'ACTIVE' : 'PENDING' },
      create: { groupId, userId, status: group.visibility === 'PUBLIC' ? 'ACTIVE' : 'PENDING' },
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
    return this.prisma.group.update({ where: { id: groupId }, data: { deletedAt: new Date() } });
  }

  async searchGroups(query: string) {
    return this.prisma.group.findMany({
      where: { deletedAt: null, name: { contains: query, mode: 'insensitive' } },
      take: 20,
      include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
    });
  }

  async listMembers(groupId: string) {
    return this.prisma.groupMember.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
  }
}
