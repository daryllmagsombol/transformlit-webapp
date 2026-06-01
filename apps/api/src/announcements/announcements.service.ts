import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AnnouncementStatus } from '@prisma/client';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, includeDrafts: boolean) {
    const now = new Date();
    const isAdmin = user.role === 'tenant_admin';

    const where: Record<string, unknown> = {
      tenantId: user.tenantId,
      deletedAt: null,
    };

    if (!(includeDrafts && isAdmin)) {
      where.status = AnnouncementStatus.published;
      where.AND = [
        {
          OR: [{ publishAt: null }, { publishAt: { lte: now } }],
        },
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      ];
    }

    return this.prisma.announcement.findMany({
      where,
      orderBy: [{ publishAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getById(user: AuthUser, id: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        deletedAt: null,
      },
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    return announcement;
  }

  async create(user: AuthUser, dto: CreateAnnouncementDto) {
    this.assertTenantAdmin(user);

    return this.prisma.announcement.create({
      data: {
        tenantId: user.tenantId,
        title: dto.title,
        body: dto.body,
        status: AnnouncementStatus.draft,
        publishAt: dto.publishAt ? new Date(dto.publishAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateAnnouncementDto) {
    this.assertTenantAdmin(user);

    const announcement = await this.getById(user, id);

    return this.prisma.announcement.update({
      where: { id: announcement.id },
      data: {
        title: dto.title ?? announcement.title,
        body: dto.body ?? announcement.body,
        publishAt: dto.publishAt
          ? new Date(dto.publishAt)
          : announcement.publishAt,
        expiresAt: dto.expiresAt
          ? new Date(dto.expiresAt)
          : announcement.expiresAt,
        updatedBy: user.id,
      },
    });
  }

  async publish(user: AuthUser, id: string) {
    this.assertTenantAdmin(user);

    const announcement = await this.getById(user, id);
    const now = new Date();

    return this.prisma.announcement.update({
      where: { id: announcement.id },
      data: {
        status: AnnouncementStatus.published,
        publishAt: announcement.publishAt ?? now,
        publishedAt: now,
        publishedById: user.id,
        updatedBy: user.id,
      },
    });
  }

  async unpublish(user: AuthUser, id: string) {
    this.assertTenantAdmin(user);

    const announcement = await this.getById(user, id);

    return this.prisma.announcement.update({
      where: { id: announcement.id },
      data: {
        status: AnnouncementStatus.draft,
        publishedAt: null,
        publishedById: null,
        updatedBy: user.id,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    this.assertTenantAdmin(user);

    const announcement = await this.getById(user, id);

    return this.prisma.announcement.update({
      where: { id: announcement.id },
      data: {
        deletedAt: new Date(),
        deletedBy: user.id,
      },
    });
  }

  private assertTenantAdmin(user: AuthUser) {
    if (user.role !== 'tenant_admin') {
      throw new ForbiddenException('Tenant admin access required');
    }
  }
}
