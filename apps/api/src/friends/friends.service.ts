import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { FriendshipStatus } from '@prisma/client';

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    // list accepted friendships for the tenant and user
    return this.prisma.friendship.findMany({
      where: {
        tenantId: user.tenantId,
        deletedAt: null,
        status: FriendshipStatus.accepted,
        OR: [{ requesterId: user.id }, { addresseeId: user.id }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async sendRequest(user: AuthUser, addresseeId: string) {
    if (addresseeId === user.id) {
      throw new BadRequestException('Cannot friend yourself');
    }

    // ensure addressee exists in same tenant
    const addressee = await this.prisma.user.findFirst({
      where: { id: addresseeId, tenantId: user.tenantId, deletedAt: null },
    });

    if (!addressee) {
      throw new NotFoundException('Addressee not found');
    }

    // upsert to avoid duplicate requests
    const existing = await this.prisma.friendship.findFirst({
      where: {
        tenantId: user.tenantId,
        OR: [
          { requesterId: user.id, addresseeId },
          { requesterId: addresseeId, addresseeId: user.id },
        ],
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.friendship.create({
      data: {
        tenantId: user.tenantId,
        requesterId: user.id,
        addresseeId,
        status: FriendshipStatus.pending,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
  }

  async respond(user: AuthUser, requestId: string, status: FriendshipStatus) {
    const request = await this.prisma.friendship.findUnique({
      where: { id: requestId },
    });

    if (!request || request.tenantId !== user.tenantId) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.addresseeId !== user.id) {
      throw new BadRequestException(
        'Only the addressee can respond to the request',
      );
    }

    return this.prisma.friendship.update({
      where: { id: request.id },
      data: { status, updatedBy: user.id },
    });
  }

  async remove(user: AuthUser, id: string) {
    const record = await this.prisma.friendship.findUnique({ where: { id } });

    if (!record || record.tenantId !== user.tenantId) {
      throw new NotFoundException('Friendship not found');
    }

    // allow either side to remove
    if (record.requesterId !== user.id && record.addresseeId !== user.id) {
      throw new BadRequestException('Not authorized to remove this friendship');
    }

    return this.prisma.friendship.update({
      where: { id: record.id },
      data: { deletedAt: new Date(), deletedBy: user.id },
    });
  }

  async search(user: AuthUser, q: string) {
    const term = `%${q.trim().toLowerCase()}%`;
    return this.prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        deletedAt: null,
        OR: [
          { emailNormalized: { contains: q.trim().toLowerCase() } },
          { profile: { displayName: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        email: true,
        profile: { select: { displayName: true, avatarUrl: true } },
      },
      take: 20,
    });
  }
}
