import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateProfileInput } from './models/user.model.js';

// Public projection excludes PII (email) and moderation-sensitive fields.
const PUBLIC_USER_SELECT = {
  id: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Only used for the authenticated actor's own profile (me); keeps email/status.
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

  async searchUsers(query: string, _actorId?: string, limit = 20) {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        displayName: { contains: query, mode: 'insensitive' },
      },
      select: PUBLIC_USER_SELECT,
      take: Math.min(limit, 50),
      orderBy: { displayName: 'asc' },
    });
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    return this.prisma.user.update({
      where: { id: userId },
      data: input,
    });
  }

  async listUsers(_actorId?: string, limit = 50) {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: PUBLIC_USER_SELECT,
      take: Math.min(limit, 100),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProfile(userId: string, currentUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user) throw new Error('User not found');

    const isSelf = userId === currentUserId;

    const profileUser = {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      role: user.role,
      createdAt: user.createdAt,
      // email + status exposed only to the account owner.
      ...(isSelf ? { email: user.email, status: user.status } : {}),
    };

    // Independent queries that depend only on known inputs — fired in one round
    // trip instead of serially. For non-self viewers the friendship gate runs
    // alongside the profile counts and decides whether progress may be read.
    const [groups, friendCount, groupCount, friendship] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { userId, status: 'ACTIVE', group: { visibility: 'PUBLIC' } },
        include: { group: true },
        take: 20,
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
      isSelf
        ? Promise.resolve(null)
        : this.prisma.friendship.findFirst({
            where: {
              status: 'ACCEPTED',
              OR: [
                { requesterId: userId, addresseeId: currentUserId },
                { requesterId: currentUserId, addresseeId: userId },
              ],
            },
          }),
    ]);

    const canViewProgress = isSelf || !!friendship;

    let bookProgress: any[] = [];
    let bookCount = 0;
    let myRows: { requesterId: string; addresseeId: string }[] = [];
    let theirRows: { requesterId: string; addresseeId: string }[] = [];

    if (canViewProgress) {
      const progressQuery = this.prisma.bookProgress.findMany({
        where: { userId },
        include: { book: true },
        orderBy: { lastReadAt: 'desc' },
        take: 10,
      });
      const countQuery = this.prisma.bookProgress.count({
        where: { userId },
      });

      if (isSelf) {
        [bookProgress, bookCount] = await Promise.all([progressQuery, countQuery]);
      } else {
        // Mutual friends are derived from both parties' accepted-friendship
        // rows; fetch both sides in the same round trip as the progress data.
        const myFriendshipsQuery = this.prisma.friendship.findMany({
          where: { OR: [{ requesterId: currentUserId }, { addresseeId: currentUserId }], status: 'ACCEPTED' },
          select: { requesterId: true, addresseeId: true },
        });
        const theirFriendshipsQuery = this.prisma.friendship.findMany({
          where: { OR: [{ requesterId: userId }, { addresseeId: userId }], status: 'ACCEPTED' },
          select: { requesterId: true, addresseeId: true },
        });

        [bookProgress, bookCount, myRows, theirRows] = await Promise.all([
          progressQuery,
          countQuery,
          myFriendshipsQuery,
          theirFriendshipsQuery,
        ]);
      }
    }

    let mutualFriends: any[] = [];
    if (!isSelf && canViewProgress) {
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
          select: { ...PUBLIC_USER_SELECT },
        });
      }
    }

    return {
      user: profileUser,
      groups: groups.map((gm) => gm.group),
      bookProgress,
      mutualFriends,
      friendCount,
      groupCount,
      bookCount,
    };
  }
}