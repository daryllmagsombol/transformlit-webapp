import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const existing = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId, addresseeId } },
    });
    if (existing) throw new Error('Friendship already exists');

    return this.prisma.friendship.create({
      data: { requesterId, addresseeId, status: 'PENDING' },
    });
  }

  async acceptRequest(friendshipId: string, userId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
    });
    if (!friendship || friendship.addresseeId !== userId) throw new Error('Not authorized');
    return this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED' },
    });
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

  async removeFriend(friendshipId: string) {
    return this.prisma.friendship.delete({ where: { id: friendshipId } });
  }
}
