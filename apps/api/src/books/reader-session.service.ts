import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export const READER_COOKIE_NAME = 'transformlit_reader';
export const READER_SESSION_TTL_MS = 15 * 60 * 1000;

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  bookId: string;
}

@Injectable()
export class ReaderSessionService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Returns the raw token; only its SHA-256 hash is persisted. */
  async create(userId: string, bookId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.readingSession.create({
      data: {
        userId,
        bookId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + READER_SESSION_TTL_MS),
      },
    });
    return token;
  }

  /** Resolves a live session and slides its expiry forward. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!token) return null;
    const session = await this.prisma.readingSession.findUnique({ where: { tokenHash: this.hash(token) } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;

    await this.prisma.readingSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + READER_SESSION_TTL_MS) },
    });
    return { sessionId: session.id, userId: session.userId, bookId: session.bookId };
  }

  async revokeAll(userId: string, bookId: string): Promise<number> {
    const result = await this.prisma.readingSession.updateMany({
      where: { userId, bookId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
