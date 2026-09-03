import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PubSubService } from '../notifications/notifications.pubsub.js';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
    private readonly pubSub: PubSubService,
  ) {}

  async listFriends(userId: string) {
    return this.prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        status: 'ACCEPTED',
      },
      include: { requester: true, addressee: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listRequests(userId: string) {
    return this.prisma.friendship.findMany({
      where: { addresseeId: userId, status: 'PENDING' },
      include: { requester: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async sendRequest(requesterId: string, addresseeId: string) {
    if (requesterId === addresseeId) throw new Error('Cannot friend yourself');
    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
        status: { not: 'REJECTED' },
      },
    });
    if (existing) throw new Error('Friendship already exists');

    // A previously rejected request (in either direction) is reactivated
    // rather than duplicated, since (requesterId, addresseeId) is unique.
    const rejected = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
        status: 'REJECTED',
      },
    });

    const friendship = rejected
      ? await this.prisma.friendship.update({
          where: { id: rejected.id },
          // Reorient to the new request's direction so the surviving row matches
          // the caller (this also covers reactivation from the opposite side).
          data: { requesterId, addresseeId, status: 'PENDING' },
        })
      : await this.prisma.friendship.create({
          data: { requesterId, addresseeId, status: 'PENDING' },
        });

    const notification = await this.notifications.createNotification(
      addresseeId,
      'FRIEND_REQUEST',
      { friendshipId: friendship.id },
      requesterId,
    );

    await this.pubSub.publish('notificationReceived', {
      notificationReceived: notification,
      userId: addresseeId,
    });

    return friendship;
  }

  async acceptRequest(friendshipId: string, userId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!friendship || friendship.addresseeId !== userId) throw new Error('Not authorized');
    const updated = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED' },
    });

    const notification = await this.notifications.createNotification(
      friendship.requesterId,
      'FRIEND_ACCEPTED',
      { friendshipId: friendship.id },
      userId,
    );

    await this.pubSub.publish('notificationReceived', {
      notificationReceived: notification,
      userId: friendship.requesterId,
    });

    return updated;
  }

  async rejectRequest(friendshipId: string, userId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!friendship || friendship.addresseeId !== userId) throw new Error('Not authorized');
    return this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'REJECTED' },
    });
  }

  async removeFriend(friendshipId: string, userId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!friendship) throw new Error('Not authorized');
    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
      throw new Error('Not authorized');
    }
    await this.prisma.friendship.delete({ where: { id: friendshipId } });
    return true;
  }

  async checkFriendship(userId: string, otherUserId: string) {
    if (userId === otherUserId) return null;

    const friendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
        NOT: { status: 'REJECTED' },
      },
      include: { requester: true, addressee: true },
    });

    return friendship;
  }

  async suggestedFriends(userId: string, limit = 5) {
    const clamped = Math.min(Math.max(limit, 1), 20);

    const myRows = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    });
    const myFriendIds = new Set<string>();
    const excludedIds = new Set<string>([userId]);
    for (const f of myRows) {
      const other = f.requesterId === userId ? f.addresseeId : f.requesterId;
      if (f.status === 'ACCEPTED') myFriendIds.add(other);
      else excludedIds.add(other); // PENDING, REJECTED, BLOCKED
    }

    const scores = new Map<string, number>();
    if (myFriendIds.size > 0) {
      const rows = await this.prisma.friendship.findMany({
        where: {
          OR: [
            { requesterId: { in: [...myFriendIds] } },
            { addresseeId: { in: [...myFriendIds] } },
          ],
          status: 'ACCEPTED',
        },
      });
      for (const f of rows) {
        const other = myFriendIds.has(f.requesterId) ? f.addresseeId : f.requesterId;
        if (excludedIds.has(other) || myFriendIds.has(other)) continue;
        scores.set(other, (scores.get(other) ?? 0) + 1);
      }
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, clamped);

    if (ranked.length === 0) {
      return this.prisma.user.findMany({
        where: {
          id: { notIn: [...excludedIds, ...myFriendIds] },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: clamped,
      });
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: ranked.map(([id]) => id) }, deletedAt: null },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return ranked.map(([id]) => byId.get(id)).filter(Boolean) as any;
  }
}
