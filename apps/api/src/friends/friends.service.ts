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
          data: { status: 'PENDING' },
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
    return this.prisma.friendship.delete({ where: { id: friendshipId } });
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
}
