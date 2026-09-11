import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResolvedSession } from './reader-session.service.js';

@Injectable()
export class PageViewService {
  constructor(private readonly prisma: PrismaService) {}

  async record(session: ResolvedSession, page: number, contentVersion: number): Promise<void> {
    await this.prisma.pageView.create({
      data: { sessionId: session.sessionId, userId: session.userId, bookId: session.bookId, page, contentVersion },
    });
  }
}
