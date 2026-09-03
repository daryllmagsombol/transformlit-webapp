import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateProfileInput } from './models/user.model.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { emailNormalized: email.toLowerCase().trim() },
    });
  }

  async searchUsers(query: string, limit = 20) {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { displayName: 'asc' },
    });
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    return this.prisma.user.update({
      where: { id: userId },
      data: input,
    });
  }

  async listUsers(limit = 50) {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProfile(userId: string, currentUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) throw new Error('User not found');

    const [groups, bookProgress, friendCount, groupCount, bookCount] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { userId, status: 'ACTIVE', group: { visibility: 'PUBLIC' } },
        include: { group: true },
        take: 20,
      }),
      this.prisma.bookProgress.findMany({
        where: { userId },
        include: { book: true },
        orderBy: { lastReadAt: 'desc' },
        take: 10,
      }),
      this.prisma.friendship.count({
        where: {
          OR: [{ requesterId: userId }, { addresseeId: userId }],
          status: 'ACCEPTED',
        },
      }),
      this.prisma.groupMember.count({
        where: { userId, status: 'ACTIVE' },
      }),
      this.prisma.bookProgress.count({
        where: { userId },
      }),
    ]);

    let mutualFriends: any[] = [];
    if (currentUserId !== userId) {
      const [myRows, theirRows] = await Promise.all([
        this.prisma.friendship.findMany({
          where: { OR: [{ requesterId: currentUserId }, { addresseeId: currentUserId }], status: 'ACCEPTED' },
          select: { requesterId: true, addresseeId: true },
        }),
        this.prisma.friendship.findMany({
          where: { OR: [{ requesterId: userId }, { addresseeId: userId }], status: 'ACCEPTED' },
          select: { requesterId: true, addresseeId: true },
        }),
      ]);
      const myIds = new Set(
        myRows.map((f) => (f.requesterId === currentUserId ? f.addresseeId : f.requesterId)),
      );
      const theirIds = new Set(
        theirRows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)),
      );
      const mutual = [...theirIds].filter((id) => id !== userId && myIds.has(id)).slice(0, 10);
      if (mutual.length > 0) {
        mutualFriends = await this.prisma.user.findMany({
          where: { id: { in: mutual }, deletedAt: null },
        });
      }
    }

    return {
      user,
      groups: groups.map((gm) => gm.group),
      bookProgress,
      mutualFriends,
      friendCount,
      groupCount,
      bookCount,
    };
  }
}
