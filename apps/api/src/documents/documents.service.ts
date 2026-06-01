import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { DocumentAccessType } from '@prisma/client';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    return this.prisma.document.findMany({
      where: { tenantId: user.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(user: AuthUser, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId: user.tenantId, deletedAt: null },
      include: { accesses: true },
    });

    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async create(
    user: AuthUser,
    dto: {
      title: string;
      description?: string;
      blobPath: string;
      fileSize?: number;
    },
  ) {
    return this.prisma.document.create({
      data: {
        tenantId: user.tenantId,
        title: dto.title,
        description: dto.description ?? null,
        blobPath: dto.blobPath,
        mimeType: 'application/pdf',
        fileSize: dto.fileSize ? BigInt(dto.fileSize) : BigInt(0),
        accessLevel: 'private',
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
  }

  async update(
    user: AuthUser,
    id: string,
    dto: { title?: string; description?: string; blobPath?: string },
  ) {
    const doc = await this.getById(user, id);

    return this.prisma.document.update({
      where: { id: doc.id },
      data: {
        title: dto.title ?? doc.title,
        description: dto.description ?? doc.description,
        blobPath: dto.blobPath ?? doc.blobPath,
        updatedBy: user.id,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    const doc = await this.getById(user, id);
    return this.prisma.document.update({
      where: { id: doc.id },
      data: { deletedAt: new Date(), deletedBy: user.id },
    });
  }

  async addAccess(
    user: AuthUser,
    documentId: string,
    dto: { userId?: string; groupId?: string; accessType: DocumentAccessType },
  ) {
    const doc = await this.getById(user, documentId);

    if (!dto.userId && !dto.groupId)
      throw new BadRequestException('userId or groupId required');

    // Build a properly-typed unique where clause depending on whether the access is for a user or a group.
    const where = dto.userId
      ? { documentId_userId: { documentId: doc.id, userId: dto.userId } }
      : { documentId_groupId: { documentId: doc.id, groupId: dto.groupId! } };

    return this.prisma.documentAccess.upsert({
      where,
      create: {
        tenantId: user.tenantId,
        documentId: doc.id,
        userId: dto.userId ?? null,
        groupId: dto.groupId ?? null,
        accessType: dto.accessType,
        createdBy: user.id,
        updatedBy: user.id,
      },
      update: {
        accessType: dto.accessType,
        updatedBy: user.id,
      },
    });
  }

  async removeAccess(user: AuthUser, documentId: string, accessId: string) {
    const access = await this.prisma.documentAccess.findUnique({
      where: { id: accessId },
    });
    if (!access || access.tenantId !== user.tenantId)
      throw new NotFoundException('Access not found');
    return this.prisma.documentAccess.update({
      where: { id: access.id },
      data: { deletedAt: new Date(), deletedBy: user.id },
    });
  }
}
