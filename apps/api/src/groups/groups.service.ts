import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { GroupMemberRole, GroupMemberStatus } from '@prisma/client';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    return this.prisma.group.findMany({
      where: { tenantId: user.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(user: AuthUser, id: string) {
    const group = await this.prisma.group.findFirst({
      where: { id, tenantId: user.tenantId, deletedAt: null },
    });

    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async create(
    user: AuthUser,
    dto: { name: string; description?: string; visibility?: any },
  ) {
    return this.prisma.group.create({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        description: dto.description ?? null,
        visibility: dto.visibility ?? 'private',
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
  }

  async update(
    user: AuthUser,
    id: string,
    dto: { name?: string; description?: string; visibility?: any },
  ) {
    const group = await this.getById(user, id);

    return this.prisma.group.update({
      where: { id: group.id },
      data: {
        name: dto.name ?? group.name,
        description: dto.description ?? group.description,
        visibility: dto.visibility ?? group.visibility,
        updatedBy: user.id,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    const group = await this.getById(user, id);

    return this.prisma.group.update({
      where: { id: group.id },
      data: { deletedAt: new Date(), deletedBy: user.id },
    });
  }

  async addMember(
    user: AuthUser,
    groupId: string,
    userId: string,
    role?: GroupMemberRole,
  ) {
    const group = await this.getById(user, groupId);

    // ensure target user exists in tenant
    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: user.tenantId },
    });
    if (!target) throw new NotFoundException('User not found');

    return this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: target.id } },
      create: {
        tenantId: user.tenantId,
        groupId: group.id,
        userId: target.id,
        role: role ?? GroupMemberRole.member,
        status: GroupMemberStatus.active,
        createdBy: user.id,
        updatedBy: user.id,
      },
      update: {
        role: role ?? GroupMemberRole.member,
        status: GroupMemberStatus.active,
        updatedBy: user.id,
      },
    });
  }

  async removeMember(user: AuthUser, groupId: string, memberId: string) {
    const group = await this.getById(user, groupId);

    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: memberId } },
    });
    if (!member) throw new NotFoundException('Member not found');

    return this.prisma.groupMember.update({
      where: { id: member.id },
      data: { deletedAt: new Date(), deletedBy: user.id },
    });
  }

  async search(user: AuthUser, q: string) {
    return this.prisma.group.findMany({
      where: {
        tenantId: user.tenantId,
        name: { contains: q, mode: 'insensitive' },
        deletedAt: null,
      },
      take: 20,
    });
  }
}
